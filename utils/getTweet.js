const DEBUG = false;
const { default_features, default_variables } = require("./twitterFeatures");
const { EmbedBuilder } = require("discord.js");
const {
    ClientTransaction,
    fetchXDocument,
} = require("x-client-transaction-id");
const { WebhookManager, WEBHOOK_TYPE } = require("./webhookManager");
const translateText = require("./translator");
const {
    sendErrorLog,
    sendInfoLog,
    sendResponseDataLog,
} = require("./DebugLogger");

let profileURL = "";
let prevLastTweetID = null;

/**
 * @type {ClientTransaction}
 */
let transaction = null;

/**
 *
 * @param {BigInt|String} userId userId is not username!!
 */
async function getTimelineByUserID(userId, count) {
    const reqURL = `https://x.com/i/api/graphql/FmuxExUC21Xn_C2NwtX5sQ/UserTweetsAndReplies?variables=${encodeURIComponent(
        JSON.stringify(
            Object.assign(default_variables, { userId: userId, count: count }),
        ),
    )}&features=${encodeURIComponent(JSON.stringify(default_features))}`;

    try {
        if (!transaction) {
            const document = await fetchXDocument();
            transaction = await ClientTransaction.create(document);
        }

        const transactionId = await transaction.generateTransactionId(
            "GET",
            "/i/api/graphql/FmuxExUC21Xn_C2NwtX5sQ/UserTweetsAndReplies",
        );

        let response = await fetch(reqURL, {
            method: "GET",
            headers: {
                referer: "https://x.com/",
                cookie: `auth_token=${process.env.TWITTER_AUTH_TOKEN}; ct0=${process.env.TWITTER_CT0};`,
                authorization:
                    "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
                "user-agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
                "x-csrf-token": process.env.TWITTER_CT0,
                "x-twitter-active-user": "yes",
                "x-twitter-client-language": "en",
                "x-client-transaction-id": transactionId,
            },
        });
        let res_text = "";
        try {
            if (!response.ok) {
                throw new Error(
                    `Twitter API response not ok: ${response.status} ${response.statusText}`,
                );
            }
            res_text = await response.text();
            res_json = JSON.parse(res_text);
            let tweets =
                res_json.data.user.result.timeline.timeline.instructions
                    .filter((e) => e.type == "TimelineAddEntries")[0]
                    .entries.filter((e) => {
                        return (
                            e.entryId.match(
                                /^profile\-conversation\-[0-9]+/g,
                            ) || e.entryId.match(/^tweet\-[0-9]+/g)
                        );
                    });

            let data = [];
            for (let i = 0; i < tweets.length; i++) {
                let e = tweets[i];

                // 마후마후 트윗만 필터링
                if (
                    e.content.itemContent.tweet_results.result.core.user_results
                        .result.core.screen_name != "uni_mafumafu"
                )
                    continue;

                if (e.entryId.match(/^tweet\-[0-9]+/g)) {
                    // 일반 트윗
                    data.push(e.content.itemContent.tweet_results.result);
                } else if (e.entryId.match(/^profile\-conversation\-[0-9]+/g)) {
                    // 타래 트윗
                    for (let j = 0; j < e.content.items.length; j++) {
                        let f = e.content.items[j];
                        if (
                            f.entryId.match(
                                /^profile\-conversation\-[0-9]+\-tweet\-[0-9]+/g,
                            )
                        )
                            data.push(f.item.itemContent.tweet_results.result);
                    }
                }
            }

            data.sort((a, b) => {
                a = BigInt(a.rest_id);
                b = BigInt(b.rest_id);
                if (a > b) {
                    return -1;
                } else if (a < b) {
                    return 1;
                } else {
                    return 0;
                }
            });

            return data;
        } catch (e) {
            sendErrorLog(e);
            sendResponseDataLog(res_text);
            throw e;
        }
    } catch (e) {
        sendErrorLog(e);
        sendResponseDataLog(res_text);
        throw e;
    }
}

/**
 * 새 트윗 감지
 */
async function checkNewTweet() {
    const webhookManager = new WebhookManager();
    await webhookManager.getConnection();
    if (!!!prevLastTweetID) {
        prevLastTweetID = await webhookManager.getLastTweetID();
        if (!!!prevLastTweetID) {
            await webhookManager.setLastTweetID(0);
            prevLastTweetID = 0;
        }
    }

    let timelineInfo;
    try {
        timelineInfo = await getTimelineByUserID(268758461);
        let lastTweetID = BigInt(timelineInfo[0].legacy.id_str);

        if (lastTweetID > prevLastTweetID || DEBUG) {
            let newTweets = timelineInfo
                .filter((e) => {
                    let id = BigInt(e.legacy.id_str);
                    return id > prevLastTweetID;
                })
                .reverse();
            prevLastTweetID = lastTweetID;
            webhookManager.setLastTweetID(String(lastTweetID));
            sendInfoLog(`${newTweets.length} new tweet detect`);
            if ((await webhookManager.getWebhookCount()) < 1) {
                console.log("No user found. Ignored");
                return;
            }
            for (let i = 0; i < newTweets.length; i++) {
                try {
                    const embed = await getWebhookEmbed(newTweets[i]);
                    await webhookManager.sendWebhook(embed);
                } catch (e) {
                    sendErrorLog(e);
                }
            }
        }
    } catch (e) {
        sendErrorLog(e);
        sendResponseDataLog(JSON.stringify(timelineInfo));
    } finally {
        webhookManager.releaseConnection();
    }
}

async function sendRecentTweet(id) {
    let timelineInfo = await getTimelineByUserID(268758461);
    const webhookManager = new WebhookManager();
    await webhookManager.getConnection();

    const embed = await getWebhookEmbed(
        !!id
            ? timelineInfo.filter((e) => e["rest_id"] == id)[0]
            : timelineInfo[0],
    );

    webhookManager.sendWebhook(embed, WEBHOOK_TYPE.TWITTER);
}

const MAX_TWEET_DEPTH = 3;

/**
 * 트윗 본문 추출 (장문 트윗은 note_tweet, 일반 트윗은 legacy.full_text)
 */
function getTweetText(tweet) {
    let text =
        tweet?.note_tweet?.note_tweet_results?.result?.text ??
        tweet?.legacy?.full_text ??
        "";

    // console.log(text);

    // Change t.co url to original url
    const urls =
        (!!tweet?.note_tweet?.note_tweet_results?.result?.text
            ? tweet?.note_tweet?.note_tweet_results?.result?.entity_set?.urls
            : tweet?.legacy?.entities?.urls) ?? [];
    for (let url of urls) {
        text = text.replace(url.url, url.expanded_url);
    }

    // Remove media urls
    const media = tweet?.legacy?.entities?.media ?? [];
    for (let m of media) {
        text = text.replace(m.url, "");
    }

    return text;
}

/**
 * 작성자를 `**이름 ([@핸들](링크))**` 형태로 변환
 */
function formatAuthor(tweet) {
    const user = tweet?.core?.user_results?.result?.core ?? {};
    const handle = user.screen_name ?? "unknown";
    return `**${user.name ?? handle} ([@${handle}](https://x.com/${handle}))**`;
}

/**
 * 각 줄 앞에 인용 블록(`>`) 추가
 * (​는 빈 줄에서도 인용 블록이 유지되도록 하기 위함)
 */
function toBlockquote(text) {
    return text
        .split("\n")
        .map((line) => `> \u200b${line}`)
        .join("\n");
}

/**
 * 트윗 정보를 번역된 Discord 마크다운으로 변환
 *
 * - RT: `RT: 작성자:` + 원본 트윗 (원본이 인용트윗이면 재귀 처리)
 * - 인용: 본문 + 인용 블록으로 감싼 인용된 트윗
 * - 답장: 맨 앞에 답장 대상 링크 추가
 *
 * @param {object} tweet 트윗 정보 Object
 * @param {number} depth 현재 중첩 깊이 (RT/인용 재귀 제한용)
 * @returns {Promise<string>}
 */
async function generateTweetMarkdown(tweet, depth = 1) {
    // console.log(JSON.stringify(tweet));
    const legacy = tweet.legacy ?? {};
    const retweeted = legacy.retweeted_status_result?.result;
    const quoted = tweet.quoted_status_result?.result;
    const canNest = depth < MAX_TWEET_DEPTH;

    let body;
    if (retweeted && canNest) {
        // RT (RT한 트윗이 인용트윗일 수 있으므로 재귀 처리)
        const inner = await generateTweetMarkdown(retweeted, depth + 1);
        body = `RT: ${formatAuthor(retweeted)}:\n${inner}`;
    } else if (quoted && canNest) {
        // 인용
        const [text, quotedText] = await Promise.all([
            translateText(getTweetText(tweet)),
            translateText(getTweetText(quoted)),
        ]);
        const quoteBlock = toBlockquote(
            `QT: ${formatAuthor(quoted)}:\n\n${quotedText}`,
        );
        body = `${text}\n\n${quoteBlock}`;
    } else {
        // 일반
        body = await translateText(getTweetText(tweet));
    }
    body = String(body).trim();

    // 답장(타래) 트윗
    const replyId = legacy.in_reply_to_status_id_str;
    if (replyId) {
        const replyHandle = legacy.in_reply_to_screen_name;
        body =
            `↩ [@${replyHandle}](https://x.com/${replyHandle}/status/${replyId})님에게 보내는 답글\n\n` +
            body;
    }

    return body;
}

/**
 * tweetInfo 데이터를 기반으로 Discord 훅 전송
 * @param {object} tweetInfo 트윗 정보 Object
 * @returns {Promise<EmbedBuilder[]>} Discord EmbedBuilder 배열
 */
async function getWebhookEmbed(tweetInfo) {
    let created_at = new Date(tweetInfo.legacy?.created_at);

    // 번역
    let translatedText = await generateTweetMarkdown(tweetInfo);
    // console.log(translatedText);
    // translatedText = await translateText(translatedText);

    //프로필 URL
    profileURL = tweetInfo.core.user_results.result.avatar.image_url;
    let originalLink =
        "https://x.com/uni_mafumafu/status/" + tweetInfo.legacy.id_str;

    const embeds = [];

    // embed 메시지 생성
    let embed = new EmbedBuilder();

    // console.log(JSON.stringify(tweetInfo, null, 2));

    embed.setTitle("New Tweet Release!");
    embed.setURL(originalLink);
    embed.setAuthor({
        name: `${tweetInfo.core.user_results.result.core.name} (@${tweetInfo.core.user_results.result.core.screen_name})`,
        iconURL: profileURL,
        url: "https://x.com/uni_mafumafu",
    });
    embed.setFooter({
        text: "마훅 - 한글 번역된 마후마후 트윗을 디스코드에서",
        iconURL: "https://mahook.bass9030.dev/logo.png",
    });
    embed.setTimestamp(created_at);
    embed.setDescription(translatedText);
    embed.setColor(0x1da1f2);

    let medias = null;

    if (!!tweetInfo.legacy.entities.media?.length) {
        // 미디어 처리(일반)
        medias = tweetInfo.legacy.entities.media;
    } else if (
        !!tweetInfo.legacy.retweeted_status_result?.result?.legacy?.entities
            ?.media?.length
    ) {
        // 미디어 처리(RT)
        medias =
            tweetInfo.legacy.retweeted_status_result?.result?.legacy?.entities
                ?.media;
    } else if (
        !!tweetInfo?.quoted_status_result &&
        !!tweetInfo.quoted_status_result.result?.legacy?.entities?.media?.length
    ) {
        // 미디어 처리(인용)
        medias = tweetInfo.quoted_status_result.result.legacy.entities.media;
    }

    if (!!medias) {
        let imgCnt = medias.length;
        if (imgCnt > 4) imgCnt = 4;
        for (let i = 0; i < imgCnt; i++) {
            const media = medias[i];
            if (["photo", "video"].includes(media.type)) {
                if (i == 0) embed.setImage(media.media_url_https);
                else {
                    let imageEmbed = new EmbedBuilder();
                    imageEmbed.setURL(originalLink);
                    imageEmbed.setImage(media.media_url_https);
                    embeds.push(imageEmbed);
                }
            }
        }
    }

    return [embed, ...embeds];
}

async function getProfileURL() {
    if (!!profileURL) {
        return profileURL;
    } else {
        try {
            let tweetInfo = await getTimelineByUserID(268758461, 1);
            tweetInfo[0].core.user_results.result.avatar.image_url;
            return profileURL;
        } catch {
            return "https://mahook.bass9030.dev/logo.png";
        }
    }
}

module.exports = {
    checkNewTweet,
    getProfileURL,
    sendRecentTweet,
    getTimelineByUserID,
};
