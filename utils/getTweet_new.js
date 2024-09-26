const default_variables = {
    count: 1000,
    withSafetyModeUserFields: true,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: true,
    withVoice: true,
    withV2Timeline: true,
    withDownvotePerspective: false,
    withBirdwatchNotes: true,
    withCommunity: true,
    withSuperFollowsUserFields: true,
    withReactionsMetadata: false,
    withReactionsPerspective: false,
    withSuperFollowsTweetFields: true,
    isMetatagsQuery: false,
    withReplays: true,
    withClientEventToken: false,
    withAttachments: true,
    withConversationQueryHighlights: true,
    withMessageQueryHighlights: true,
    withMessages: true,
};

const default_features = {
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
};

/* ============== */
const DEBUG = false;
const fs = require("fs");
const path = require("path");
const deepl = require("deepl-node");
const appRoot = require("app-root-path").path;
require("dotenv").config({
    path: path.join(appRoot, ".env"),
});
const { MessageBuilder, Webhook } = require("discord-webhook-node");
const webhookManager = require("./webhookManager");
const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
    GoogleGenerativeAIError,
} = require("@google/generative-ai");
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction:
        "Translate japanese to korean. Only translated sentences should be displayed in the response.",
});

const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 8192,
};

let profileURL = "";
let prevLastTweetID = null;

async function sendDebugLog(message, file) {
    const hook = new Webhook(process.env.DEBUG_WEBHOOK_URL);
    if (!!file) await hook.sendFile(file);
    else await hook.send(message);
}

/**
 *
 * @param {BigInt|String} userId userId is not username!!
 */
async function getTimelineByUserID(userId) {
    const reqURL = `https://x.com/i/api/graphql/eS7LO5Jy3xgmd3dbL044EA/UserTweets?variables=${encodeURIComponent(
        JSON.stringify(Object.assign(default_variables, { userId: userId }))
    )}&features=${encodeURIComponent(JSON.stringify(default_features))}`;

    try {
        let response = await fetch(reqURL, {
            method: "GET",
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
                Referer: "https://x.com/",
                "x-csrf-token": process.env.TWITTER_CT0,
                Cookie: `auth_token=${process.env.TWITTER_AUTH_TOKEN};ct0=${process.env.TWITTER_CT0};`,
                Authorization:
                    "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
                "x-twitter-active-user": "yes",
                "x-twitter-client-language": "en",
            },
        });
        try {
            let res_json = await response.json();
            let tweets =
                res_json.data.user.result.timeline_v2.timeline.instructions
                    .filter((e) => e.type == "TimelineAddEntries")[0]
                    .entries.filter((e) => {
                        return (
                            e.entryId.match(/^tweet\-[0-9]+/g) &&
                            e.content.itemContent.tweet_results.result.core
                                .user_results.result.id ==
                                "VXNlcjoyNjg3NTg0NjE="
                        );
                    })
                    .map((e) => e.content.itemContent.tweet_results.result);
            return { success: true, data: tweets };
        } catch (e) {
            await sendDebugLog(
                `[${new Date().toLocaleString(
                    "ja"
                )}] Response parse failed\n\`\`\`shell\n${e.stack}\n\`\`\``
            );
            fs.writeFileSync(
                "./tweetData.json",
                JSON.stringify(await response.text(), null, 4)
            );
            await sendDebugLog(null, "./tweetData.json");
            return { success: false };
        }
    } catch (e) {
        await sendDebugLog(
            `[${new Date().toLocaleString(
                "ja"
            )}] Tweet query fail\n\`\`\`shell\n${e.stack}\n\`\`\``
        );
        return { success: false };
    }
}

/**
 * 번역 (DeepL 번역)
 * @param {string} source 번역할 언어(auto: 자동인식)
 * @param {string} target 번역될 언어
 * @param {string} query 번역할 텍스트
 */
async function translateTextDeepL(source, target, query) {
    const translator = new deepl.Translator(process.env.DEEPL_API_KEY);

    // query = convertToHalf(query);
    let response = await translator.translateText(
        query,
        source == "auto" || !!source ? source : null,
        target,
        {
            glossary: process.env.DEEPL_GLOSSARY_ID,
        }
    );

    return response.text;
}

/**
 * Gemini로 번역을 시도하고 실패시 DeepL로 번역합니다.
 * @param {string} text 번역할 텍스트
 */
async function tryTranslateText(text) {
    let result = null;
    try {
        result = await translateTextGemini(text);
    } catch (e) {
        if (e instanceof GoogleGenerativeAIError) {
            sendDebugLog(
                `[${new Date().toLocaleString(
                    "ja"
                )}] tweet translate fallback. try deepl translate.`
            );
            result = await translateTextDeepL("ja", "ko", text);
        }
    }

    return result;
}

/**
 * 번역 (Gemini 1.5 Flash)
 * @param {string} query 번역할 텍스트
 */
async function translateTextGemini(query) {
    const chatSession = model.startChat({
        generationConfig,
    });

    const result = await chatSession.sendMessage(query);
    return result.response.text().replace(/\\/g, "\\\\\\");
}

/**
 * 새 트윗 감지
 */
async function checkNewTweet() {
    if (!!!prevLastTweetID) {
        prevLastTweetID = await webhookManager.getLastTweetID();
        if (!!!prevLastTweetID) {
            await webhookManager.setLastTweetID(0);
            prevLastTweetID = 0;
        }
    }
    let data;
    try {
        data = await getTimelineByUserID(268758461);
        if (!data.success) return;
        let timelineInfo = data.data;
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
            for (let i = 0; i < newTweets.length; i++) {
                try {
                    await sendHook(newTweets[i]);
                } catch (e) {
                    await sendDebugLog(
                        `[${new Date().toLocaleString(
                            "ja"
                        )}] Tweet send fail\n\`\`\`\n${e.stack}\n\`\`\``
                    );
                }
            }
        }
    } catch (e) {
        await sendDebugLog(
            `[${new Date().toLocaleString("ja")}] Tweet send fail\n\`\`\`\n${
                e.stack
            }\n\`\`\``
        );
        fs.writeFileSync("./tweetData.json", JSON.stringify(data, null, 4));
        await sendDebugLog(null, "./tweetData.json");
    }
}

async function sendRecentTweet() {
    let timelineInfo = await getTimelineByUserID(268758461);
    await sendHook(timelineInfo.data[0]);
}

/**
 * tweetInfo 데이터를 기반으로 Discord 훅 전송
 * @param {object} tweetInfo 트윗 정보 Object
 */
async function sendHook(tweetInfo) {
    // 트위터 본문 (장문일시 note_tweet, 일반일시 legacy.full_text)
    let content = !!tweetInfo.note_tweet
        ? tweetInfo.note_tweet.note_tweet_results.result.text
        : tweetInfo.legacy.full_text;
    let created_at = new Date(tweetInfo.legacy.created_at);

    // 번역
    let translatedText = await tryTranslateText(content.trim());

    //프로필 URL
    profileURL =
        tweetInfo.core.user_results.result.legacy.profile_image_url_https;
    let originalLink =
        "https://x.com/uni_mafumafu/status/" + tweetInfo.legacy.id_str;

    // 인용 트윗 처리
    if (tweetInfo.legacy?.is_quote_status) {
        translatedText += `\n\n${tweetInfo.legacy.quoted_status_permalink.expanded}`;
    }

    // embed 메시지 생성
    let embed = new MessageBuilder()
        .setTitle("New Tweet Release!")
        .setURL(originalLink)
        .setFooter(originalLink, profileURL)
        .setTimestamp(created_at)
        .setDescription(translatedText.trim())
        .setColor("#1da1f2");

    // 미디어 처리
    if (
        !!tweetInfo.legacy.entities.media?.length &&
        tweetInfo.legacy.entities.media[0].type == "photo"
    )
        embed.setImage(tweetInfo.legacy.entities.media[0].media_url_https);

    await webhookManager.sendWebhook(embed);
}

async function getProfileURL() {
    if (!!profileURL) {
        return profileURL;
    } else {
        let tweetInfo = await getTimelineByUserID(268758461);
        if (tweetInfo.success) {
            profileURL =
                tweetInfo.data[0].core.user_results.result.legacy
                    .profile_image_url_https;
            return profileURL;
        } else return "https://mahook.bass9030.dev/logo.png";
    }
}

module.exports = { checkNewTweet, getProfileURL, sendRecentTweet };
