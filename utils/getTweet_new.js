const default_variables = {
    count: 20,
    includePromotedContent: true,
    withQuickPromoteEligibilityTweetFields: true,
    withVoice: true,
    withV2Timeline: true,
};

const default_features = {
    rweb_video_screen_enabled: false,
    payments_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: true,
    responsive_web_jetfuel_frame: true,
    responsive_web_grok_share_attachment_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    responsive_web_grok_show_grok_translated_post: false,
    responsive_web_grok_analysis_button_from_backend: true,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: false,
    responsive_web_enhance_cards_enabled: false,
};

/* ============== */
const DEBUG = false;
const fs = require("fs");
const deepl = require("deepl-node");
const { MessageBuilder, Webhook } = require("discord-webhook-node");
const { webhookManager } = require("./webhookManager");
const glossary = require("./glossary.json");
const systemInstruction =
    "Translate japanese to korean. Only translated sentences should be displayed in the response. Some words should be translated as below.\n" +
    glossary.map((e) => `${e.source} is ${e.target}`).join(". ");
const { GoogleGenAI } = require("@google/genai");
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenAI({ apiKey });

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
    const reqURL = `https://x.com/i/api/graphql/oRJs8SLCRNRbQzuZG93_oA/UserTweets?variables=${encodeURIComponent(
        JSON.stringify(Object.assign(default_variables, { userId: userId }))
    )}&features=${encodeURIComponent(JSON.stringify(default_features))}`;

    try {
        let response = await fetch(reqURL, {
            method: "GET",
            headers: {
                cookie: `auth_token=${process.env.TWITTER_AUTH_TOKEN}; ct0=${process.env.TWITTER_CT0};`,
                authorization:
                    "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
                "x-csrf-token": process.env.TWITTER_CT0,
            },
        });
        let res_text;
        try {
            res_text = await response.text();
            res_json = JSON.parse(res_text);
            let tweets =
                res_json.data.user.result.timeline.timeline.instructions
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
                `[${new Date().toLocaleString(
                    "ja"
                )}] Response parse failed\n\`\`\`shell\n${e.stack}\n\`\`\``
            );
            fs.writeFileSync("./tweetData", res_text);
            await sendDebugLog(null, "./tweetData");
            throw e;
        }
    } catch (e) {
        await sendDebugLog(
            `[${new Date().toLocaleString(
                "ja"
            )}] Tweet query fail\n\`\`\`shell\n${e.stack}\n\`\`\``
        );
        throw e;
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
    console.log(text);
    try {
        result = await translateTextGemini(text);
    } catch (e) {
        sendDebugLog(
            `[${new Date().toLocaleString(
                "ja"
            )}] Gemini translate fallback. try deepL translate.`
        );
        result = await translateTextDeepL("ja", "ko", text);
    }

    return result;
}

/**
 * 번역 (Gemini 1.5 Flash)
 * @param {string} query 번역할 텍스트
 */
async function translateTextGemini(query) {
    const result = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: query,
        config: {
            safetySettings: [
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_NONE",
                },
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_NONE",
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_NONE",
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_NONE",
                },
            ],
            systemInstruction: systemInstruction,
        },
    });
    return result.text.replace(/\\/g, "\\\\\\");
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
        fs.writeFileSync(
            "./tweetData.json",
            JSON.stringify(timelineInfo | "", null, 4)
        );
        await sendDebugLog(null, "./tweetData.json");
    }
}

async function sendRecentTweet(id) {
    let timelineInfo = await getTimelineByUserID(268758461);
    // fs.writeFileSync("./timeline.json", JSON.stringify(timelineInfo, null, 4));

    await sendHook(
        !!id
            ? timelineInfo.filter((e) => e["rest_id"] == id)[0]
            : timelineInfo[0]
    );
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
