const DEBUG = false;
const { default_features, default_variables } = require("./twitterFeatures");
const { EmbedBuilder } = require("discord.js");
const { WebhookManager, WEBHOOK_TYPE } = require("./webhookManager");
const translateText = require("./translator");
const sendDebugLog = require("./DebugLogger");

let profileURL = "";
let prevLastTweetID = null;

/**
 *
 * @param {BigInt|String} userId userId is not username!!
 */
async function getTimelineByUserID(userId) {
    const reqURL = `https://x.com/i/api/graphql/Y9WM4Id6UcGFE8Z-hbnixw/UserTweets?variables=${encodeURIComponent(
        JSON.stringify(Object.assign(default_variables, { userId: userId }))
    )}&features=${encodeURIComponent(JSON.stringify(default_features))}`;

    try {
        let response = await fetch(reqURL, {
            method: "GET",
            headers: {
                referer: "https://x.com/",
                cookie: `auth_token=${process.env.TWITTER_AUTH_TOKEN}; ct0=${process.env.TWITTER_CT0};`,
                authorization:
                    "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
                "x-csrf-token": process.env.TWITTER_CT0,
                "x-twitter-active-user": "yes",
                "x-twitter-client-language": "en",
            },
        });
        let res_text;
        try {
            res_text = await response.text();
            res_json = JSON.parse(res_text);
            let tweets =
                res_json.data.user.result.timeline_v2.timeline.instructions
                    .filter((e) => e.type == "TimelineAddEntries")[0]
                    .entries.filter((e) => {
                        return (
                            e.entryId.match(
                                /^profile\-conversation\-[0-9]+/g
                            ) || e.entryId.match(/^tweet\-[0-9]+/g)
                        );
                    });

            let data = [];
            for (let i = 0; i < tweets.length; i++) {
                let e = tweets[i];
                if (e.entryId.match(/^tweet\-[0-9]+/g)) {
                    // 일반 트윗
                    data.push(e.content.itemContent.tweet_results.result);
                } else if (e.entryId.match(/^profile\-conversation\-[0-9]+/g)) {
                    // 타래 트윗
                    for (let j = 0; j < e.content.items.length; j++) {
                        let f = e.content.items[j];
                        if (
                            !f.entryId.match(
                                /^profile\-conversation\-[0-9]+\-tweet\-[0-9]+/g
                            )
                        )
                            continue;
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
            await sendDebugLog(
                `Response parse failed\n\`\`\`\n${e.stack}\n\`\`\``,
                res_text
            );
            throw e;
        }
    } catch (e) {
        await sendDebugLog(`Tweet query fail\n\`\`\`\n${e.stack}\n\`\`\``);
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
            console.log(
                `[${new Date().toLocaleString("ja")}] Detect ${
                    newTweets.length
                } new tweet`
            );
            if ((await webhookManager.getWebhookCount()) < 1) {
                console.log("No user found. Ignored");
                return;
            }
            for (let i = 0; i < newTweets.length; i++) {
                try {
                    const embed = await getWebhookEmbed(newTweets[i]);
                    await webhookManager.sendWebhook(embed);
                } catch (e) {
                    await sendDebugLog(
                        `Tweet send fail\n\`\`\`\n${e.stack}\n\`\`\``
                    );
                }
            }
        }
    } catch (e) {
        await sendDebugLog(
            `Tweet send fail\n\`\`\`\n${e.stack}\n\`\`\``,
            JSON.stringify(timelineInfo, null, 4)
        );
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
            : timelineInfo[0]
    );

    webhookManager.sendWebhook(embed, WEBHOOK_TYPE.TWITTER);
}

async function generationTweetMarkdown(tweetInfo, stack = 0, max_stack = 3) {
    stack++;

    // console.log(JSON.stringify(tweetInfo, null, 4));

    let result = "";

    let isRetweet =
        tweetInfo.legacy?.retweeted ||
        !!tweetInfo.legacy?.retweeted_status_result;
    let isQuote =
        tweetInfo.legacy?.is_quote_status || !!tweetInfo.quoted_status_result;

    // 인용/RT 트윗 처리
    // 인용트를 RT | retweeted: true, is_quote_status: true, retweeted_status_result에 인용트 내용
    // 인용트를 인용 | retweeted: false, is_quote_status: true, quoted_status_result에 인용트 내용
    // RT | retweeted: true, is_quote_status: false, retweeted_status_result에 RT내용
    // 인용트 | retweeted: false, is_qoute_status: true, quoted_status_result에 인용트 내용
    if (isRetweet && stack < max_stack) {
        // RT
        let retweetData = tweetInfo.legacy?.retweeted_status_result.result;
        let retweetUser = retweetData?.core?.user_results?.result.legacy;

        // RT 트윗 사용자 정보
        let retweetUserName = retweetUser.name;
        let retweetUserHandle = retweetUser.screen_name;

        let retweetText = "";

        // RT 트윗에 인용 여부 확인
        if (
            (retweetData.legacy.is_quote_status ||
                !!retweetData.quoted_status_result) &&
            stack < max_stack
        ) {
            // 인용트윗
            retweetText = await generationTweetMarkdown(
                retweetData,
                stack,
                max_stack
            );
        } else {
            // 일반트윗
            retweetText = !!retweetData.note_tweet
                ? retweetData.note_tweet.note_tweet_results.result.text
                : retweetData.legacy.full_text;

            retweetText = await translateText(retweetText);
        }

        result =
            `RT: **${retweetUserName} ([@${retweetUserHandle}](https://x.com/${retweetUserHandle}))**:\n` +
            `${retweetText}`;
    } else if (isQuote && stack < max_stack) {
        // 인용
        let quoteData = tweetInfo.quoted_status_result.result;
        let quoteUser = quoteData.core.user_results.result.legacy;

        // 인용 트윗 사용자 정보
        let quoteUserName = quoteUser.name;
        let quoteUserHandle = quoteUser.screen_name;

        // 인용 트윗 본문
        let quoteText = !!tweetInfo.note_tweet
            ? tweetInfo.note_tweet.note_tweet_results.result.text
            : tweetInfo.legacy.full_text;

        quoteText = await translateText(quoteText);

        // 인용한 트윗 내용
        let innerQuoteText = quoteData.note_tweet
            ? quoteData.note_tweet.note_tweet_results.result.text
            : quoteData.legacy.full_text;

        innerQuoteText = await translateText(innerQuoteText);
        innerQuoteText =
            `QT: **${quoteUserName} ([@${quoteUserHandle}](https://x.com/${quoteUserHandle}))**:\n\n` +
            innerQuoteText;
        if (stack <= 2)
            innerQuoteText = innerQuoteText
                .split("\n")
                .map((e) => "> \u200b" + e)
                .join("\n");

        result = `${quoteText}\n\n` + `${innerQuoteText}`;
    } else {
        // 일반
        // 트윗 본문 (장문일시 note_tweet, 일반일시 legacy.full_text)
        let content = !!tweetInfo.note_tweet
            ? tweetInfo.note_tweet.note_tweet_results.result.text
            : tweetInfo.legacy.full_text;
        result = await translateText(content);
    }
    result = String(result).trim();
    return result;
}

/**
 * tweetInfo 데이터를 기반으로 Discord 훅 전송
 * @param {object} tweetInfo 트윗 정보 Object
 */
async function getWebhookEmbed(tweetInfo) {
    let created_at = new Date(tweetInfo.legacy?.created_at);

    // 번역
    let translatedText = await generationTweetMarkdown(tweetInfo);
    // console.log(translatedText);
    // translatedText = await translateText(translatedText);

    //프로필 URL
    profileURL =
        tweetInfo.core.user_results.result.legacy.profile_image_url_https;
    let originalLink =
        "https://x.com/uni_mafumafu/status/" + tweetInfo.legacy.id_str;

    // embed 메시지 생성
    let embed = new EmbedBuilder();

    embed.setTitle("New Tweet Release!");
    embed.setURL(originalLink);
    embed.setFooter({
        text: originalLink,
        iconURL: profileURL,
    });
    embed.setTimestamp(created_at);
    embed.setDescription(translatedText);
    embed.setColor(0x1da1f2);

    // 미디어 처리
    if (!!tweetInfo.legacy.entities.media?.length) {
        if (
            tweetInfo.legacy.entities.media[0].type == "photo" ||
            tweetInfo.legacy.entities.media[0].type == "video"
        )
            embed.setImage(tweetInfo.legacy.entities.media[0].media_url_https);
    }

    return embed;
}

async function getProfileURL() {
    if (!!profileURL) {
        return profileURL;
    } else {
        try {
            let tweetInfo = await getTimelineByUserID(268758461);
            tweetInfo[0].core.user_results.result.legacy
                .profile_image_url_https;
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

// async function test() {
//     console.log(await getTimelineByUserID(268758461));
// }

// if (require.main === module) {
//     test();
// }
