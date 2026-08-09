import { EmbedBuilder } from "discord.js";
import translateText from "./translator";
import { defaultFeatures, defaultVariables } from "./twitterFeatures";
import { sendErrorLog, sendInfoLog, sendResponseDataLog } from "./DebugLogger";
import { WebhookManager, WebhookType } from "./webhookManager";

interface TweetUserCore {
    name: string;
    screen_name: string;
}

interface TweetResult {
    rest_id: string;
    core: {
        user_results: {
            result: {
                core: TweetUserCore;
                avatar: { image_url: string };
            };
        };
    };
    legacy: {
        id_str: string;
        created_at: string;
        full_text: string;
        retweeted?: boolean;
        is_quote_status?: boolean;
        retweeted_status_result?: { result: TweetResult };
        entities: {
            media?: Array<{
                type: "photo" | "video" | string;
                media_url_https: string;
            }>;
        };
    };
    note_tweet?: { note_tweet_results: { result: { text: string } } };
    quoted_status_result?: { result: TweetResult };
}

interface TimelineEntry {
    entryId: string;
    content: {
        itemContent?: { tweet_results: { result: TweetResult } };
        items?: Array<{
            entryId: string;
            item: { itemContent: { tweet_results: { result: TweetResult } } };
        }>;
    };
}

interface TimelineResponse {
    data: {
        user: {
            result: {
                timeline: {
                    timeline: {
                        instructions: Array<{
                            type: string;
                            entries?: TimelineEntry[];
                        }>;
                    };
                };
            };
        };
    };
}

const USER_ID = "268758461";
let profileURL = "";
let previousTweetID: bigint | null = null;

function requireTwitterCredentials(): { authToken: string; csrfToken: string } {
    const authToken = process.env.TWITTER_AUTH_TOKEN;
    const csrfToken = process.env.TWITTER_CT0;
    if (!authToken || !csrfToken) {
        throw new Error("TWITTER_AUTH_TOKEN and TWITTER_CT0 are required");
    }
    return { authToken, csrfToken };
}

export async function getTimelineByUserID(
    userId: string | number | bigint,
): Promise<TweetResult[]> {
    const variables = { ...defaultVariables, userId: String(userId) };
    const requestURL = `https://x.com/i/api/graphql/oRJs8SLCRNRbQzuZG93_oA/UserTweets?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(defaultFeatures))}`;
    const { authToken, csrfToken } = requireTwitterCredentials();
    let responseText = "";

    try {
        const response = await fetch(requestURL, {
            headers: {
                referer: "https://x.com/",
                cookie: `auth_token=${authToken}; ct0=${csrfToken};`,
                authorization:
                    "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
                "user-agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36",
                "x-csrf-token": csrfToken,
                "x-twitter-active-user": "yes",
                "x-twitter-client-language": "en",
            },
        });
        responseText = await response.text();
        if (!response.ok) {
            throw new Error(
                `Twitter API response not ok: ${response.status} ${response.statusText}`,
            );
        }
        const body = JSON.parse(responseText) as TimelineResponse;
        const instructions = body.data.user.result.timeline.timeline.instructions;
        const entries =
            instructions.find(({ type }) => type === "TimelineAddEntries")
                ?.entries ?? [];
        const tweets: TweetResult[] = [];

        for (const entry of entries) {
            if (/^tweet-[0-9]+$/.test(entry.entryId)) {
                const tweet = entry.content.itemContent?.tweet_results.result;
                if (tweet) tweets.push(tweet);
            } else if (/^profile-conversation-[0-9]+/.test(entry.entryId)) {
                for (const item of entry.content.items ?? []) {
                    if (/^profile-conversation-[0-9]+-tweet-[0-9]+/.test(item.entryId)) {
                        tweets.push(item.item.itemContent.tweet_results.result);
                    }
                }
            }
        }
        return tweets.sort((left, right) =>
            BigInt(left.rest_id) > BigInt(right.rest_id) ? -1 : 1,
        );
    } catch (error) {
        sendErrorLog(error);
        sendResponseDataLog(responseText);
        throw error;
    }
}

export async function checkNewTweet(): Promise<void> {
    const manager = new WebhookManager();
    await manager.getConnection();
    try {
        if (previousTweetID === null) {
            const storedID = await manager.getLastTweetID();
            previousTweetID = BigInt(storedID ?? "0");
        }
        const timeline = await getTimelineByUserID(USER_ID);
        const newest = timeline[0];
        if (!newest) return;
        const newestID = BigInt(newest.legacy.id_str);
        if (newestID <= previousTweetID) return;

        const newTweets = timeline
            .filter((tweet) => BigInt(tweet.legacy.id_str) > previousTweetID!)
            .reverse();
        previousTweetID = newestID;
        await manager.setLastTweetID(String(newestID));
        sendInfoLog(`${newTweets.length} new tweet detected`);
        if ((await manager.getWebhookCount()) === 0) return;

        for (const tweet of newTweets) {
            try {
                await manager.sendWebhook(await getWebhookEmbed(tweet));
            } catch (error) {
                sendErrorLog(error);
            }
        }
    } catch (error) {
        sendErrorLog(error);
    } finally {
        await manager.releaseConnection();
    }
}

export async function sendRecentTweet(id?: string): Promise<void> {
    const timeline = await getTimelineByUserID(USER_ID);
    const tweet = id
        ? timeline.find(({ rest_id }) => rest_id === id)
        : timeline[0];
    if (!tweet) throw new Error("Tweet not found");

    const manager = new WebhookManager();
    await manager.getConnection();
    try {
        await manager.sendWebhook(
            await getWebhookEmbed(tweet),
            WebhookType.TWITTER,
        );
    } finally {
        await manager.releaseConnection();
    }
}

function tweetText(tweet: TweetResult): string {
    return tweet.note_tweet?.note_tweet_results.result.text ?? tweet.legacy.full_text;
}

async function generationTweetMarkdown(
    tweet: TweetResult,
    depth = 0,
    maxDepth = 3,
): Promise<string> {
    const nextDepth = depth + 1;
    const retweet = tweet.legacy.retweeted_status_result?.result;
    const quote = tweet.quoted_status_result?.result;

    if ((tweet.legacy.retweeted || retweet) && retweet && nextDepth < maxDepth) {
        const user = retweet.core.user_results.result.core;
        const content =
            (retweet.legacy.is_quote_status || retweet.quoted_status_result) &&
            nextDepth < maxDepth
                ? await generationTweetMarkdown(retweet, nextDepth, maxDepth)
                : await translateText(tweetText(retweet));
        return `RT: **${user.name} ([@${user.screen_name}](https://x.com/${user.screen_name}))**:\n${content}`.trim();
    }

    if ((tweet.legacy.is_quote_status || quote) && quote && nextDepth < maxDepth) {
        const user = quote.core.user_results.result.core;
        const outer = await translateText(tweetText(tweet));
        let inner = `QT: **${user.name} ([@${user.screen_name}](https://x.com/${user.screen_name}))**:\n\n${await translateText(tweetText(quote))}`;
        if (nextDepth <= 2) {
            inner = inner
                .split("\n")
                .map((line) => `> \u200b${line}`)
                .join("\n");
        }
        return `${outer}\n\n${inner}`.trim();
    }
    return (await translateText(tweetText(tweet))).trim();
}

async function getWebhookEmbed(tweet: TweetResult): Promise<EmbedBuilder> {
    profileURL = tweet.core.user_results.result.avatar.image_url;
    const originalLink = `https://x.com/uni_mafumafu/status/${tweet.legacy.id_str}`;
    const embed = new EmbedBuilder()
        .setTitle("New Tweet Release!")
        .setURL(originalLink)
        .setFooter({ text: originalLink, iconURL: profileURL })
        .setTimestamp(new Date(tweet.legacy.created_at))
        .setDescription(await generationTweetMarkdown(tweet))
        .setColor(0x1da1f2);
    const media = tweet.legacy.entities.media?.[0];
    if (media && (media.type === "photo" || media.type === "video")) {
        embed.setImage(media.media_url_https);
    }
    return embed;
}

export async function getProfileURL(): Promise<string> {
    if (profileURL) return profileURL;
    try {
        const tweet = (await getTimelineByUserID(USER_ID))[0];
        profileURL = tweet?.core.user_results.result.avatar.image_url ?? "";
    } catch {
        // Welcome messages can safely use the service logo when X is unavailable.
    }
    return profileURL || "https://mahook.bass9030.dev/logo.png";
}
