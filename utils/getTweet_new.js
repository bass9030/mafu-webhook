const default_variables = {
    'count': 1000,
    'withSafetyModeUserFields': true,
    'includePromotedContent': false,
    'withQuickPromoteEligibilityTweetFields': true,
    'withVoice': true,
    'withV2Timeline': true,
    'withDownvotePerspective': false,
    'withBirdwatchNotes': true,
    'withCommunity': true,
    'withSuperFollowsUserFields': true,
    'withReactionsMetadata': false,
    'withReactionsPerspective': false,
    'withSuperFollowsTweetFields': true,
    'isMetatagsQuery': false,
    'withReplays': true,
    'withClientEventToken': false,
    'withAttachments': true,
    'withConversationQueryHighlights': true,
    'withMessageQueryHighlights': true,
    'withMessages': true,
};

const default_features = {
    "responsive_web_graphql_exclude_directive_enabled": true,
    "verified_phone_label_enabled": false,
    "creator_subscriptions_tweet_preview_api_enabled": true,
    "responsive_web_graphql_timeline_navigation_enabled": true,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
    "c9s_tweet_anatomy_moderator_badge_enabled": true,
    "tweetypie_unmention_optimization_enabled": true,
    "responsive_web_edit_tweet_api_enabled": true,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": true,
    "view_counts_everywhere_api_enabled": true,
    "longform_notetweets_consumption_enabled": true,
    "responsive_web_twitter_article_tweet_consumption_enabled": true,
    "tweet_awards_web_tipping_enabled": false,
    "freedom_of_speech_not_reach_fetch_enabled": true,
    "standardized_nudges_misinfo": true,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
    "rweb_video_timestamps_enabled": true,
    "longform_notetweets_rich_text_read_enabled": true,
    "longform_notetweets_inline_media_enabled": true,
    "responsive_web_enhance_cards_enabled": false
}

/* ============== */
const DEBUG = false;
const fs = require('fs');
const path = require('path')
const deepl = require('deepl-node');
const appRoot = require('app-root-path').path;
require('dotenv').config({
    path: path.join(appRoot, '.env')
});
const { MessageBuilder } = require('discord-webhook-node');
const webhookManager = require('./webhookManager');

let profileURL = '';
let prevLastTweetID = 0;
if(fs.existsSync('./lastTweet.txt')) prevLastTweetID = BigInt(fs.readFileSync('./lastTweet.txt'));
else fs.writeFileSync('./lastTweet.txt', '0');


function convertToHalf(e) {
    return e.replace(/[！-～]/g, (halfwidthChar) =>
      String.fromCharCode(halfwidthChar.charCodeAt(0) - 0xfee0)
    ).replace(/、/g, ', ').replace(/。/g, '.');
}

/**
 * 
 * @param {BigInt|String} userId userId is not username!!
 */
async function getTimelineByUserID(userId) {
    const reqURL = `https://twitter.com/i/api/graphql/eS7LO5Jy3xgmd3dbL044EA/UserTweets?variables=${encodeURIComponent(JSON.stringify(Object.assign(default_variables, {userId: userId})))}&features=${encodeURIComponent(JSON.stringify(default_features))}`;
    
    
    try {
    let response = await fetch(reqURL,
    {
        method: 'GET',
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
            "Referer": "https://twitter.com/",
            "x-csrf-token": process.env.TWITTER_CT0,
            "Cookie": `auth_token=${process.env.TWITTER_AUTH_TOKEN};ct0=${process.env.TWITTER_CT0};`,
            "Authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
            "x-twitter-active-user": "yes",
            "x-twitter-client-language": "en"
        }
    });
        let res_json = await response.json();
        let tweets = res_json.data.user.result.timeline_v2.timeline.instructions.filter(e => e.type == "TimelineAddEntries")[0]
                    .entries.filter(e => {
                        return e.entryId.match(/^tweet\-[0-9]+/g) && 
                        e.content.itemContent.tweet_results.result.core.user_results.result.id == 'VXNlcjoyNjg3NTg0NjE=';
                    })
                    .map(e => e.content.itemContent.tweet_results.result);
        return tweets;
    }catch(e) {
        console.error(e)
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
    query = convertToHalf(query);
    let querys = query.match(/[一-龠ぁ-ゔァ-ヴーa-zA-Z0-9ａ-ｚＡ-Ｚ０-９々〆〤ヶ!-~ ]+/g);
    let result = query;
    for(let e of querys) {
        let response = await translator.translateText(e, (source == 'auto' || !!source) ? source : null, target, {
            glossary: '0e46d5a2-c745-41c7-8ccd-d29b986de309'
        });
        result = result.replace(e, response.text);
    }

    return result;
}

/**
 * 새 트윗 감지
 */
async function checkNewTweet() {
    let timelineInfo = await getTimelineByUserID(268758461);
    let lastTweetID = BigInt(timelineInfo[0].legacy.id_str);

    if(lastTweetID > prevLastTweetID || DEBUG) {
        let newTweets = timelineInfo.filter(e => {
            let id = BigInt(e.legacy.id_str);
            return id > prevLastTweetID
        }).reverse();
        prevLastTweetID = lastTweetID;
        fs.writeFileSync('./lastTweet.txt', String(lastTweetID));
        console.log(`[${new Date().toLocaleString('ja')}] ${newTweets.length} new tweet detect`);
        for(let i = 0; i < newTweets.length; i++) {
            await sendHook(newTweets[i]);
        }
    }
}

async function sendRecentTweet() {
    let timelineInfo = (await getTimelineByUserID(268758461));
    await sendHook(timelineInfo[0]);
}

/**
 * tweetInfo 데이터를 기반으로 Discord 훅 전송
 * @param {object} tweetInfo 트윗 정보 Object
 */
async function sendHook(tweetInfo) {
    // 트위터 본문 (장문일시 note_tweet, 일반일시 legacy.full_text)
    let content = (!!tweetInfo.note_tweet) ? 
                    tweetInfo.note_tweet.note_tweet_results.result.text : 
                    tweetInfo.legacy.full_text;
    let created_at = new Date(tweetInfo.legacy.created_at);

    // DeepL 번역
    let translatedText = await translateTextDeepL('ja', 'ko', content.trim());

    //프로필 URL
    profileURL = tweetInfo.core.user_results.result.legacy.profile_image_url_https;
    let originalLink = 'https://twitter.com/uni_mafumafu/status/' + tweetInfo.legacy.id_str;

    // 인용 트윗 처리
    if(tweetInfo.legacy?.is_quote_status) {
        translatedText += `\n\n${tweetInfo.legacy.quoted_status_permalink.expanded}`
    }

    // embed 메시지 생성
    let embed = new MessageBuilder()
        .setTitle('New Tweet Release!')
        .setURL(originalLink)
        .setFooter(originalLink, profileURL)
        .setTimestamp(created_at)
        .setDescription(translatedText.trim())
        .setColor('#1da1f2');
    
    // 미디어 처리
    if(!!tweetInfo.legacy.entities.media?.length && tweetInfo.legacy.entities.media[0].type == 'photo') embed.setImage(tweetInfo.legacy.entities.media[0].media_url_https);
    
    webhookManager.sendWebhook(embed);
}

async function getProfileURL() {
    if(!!profileURL) {
        return profileURL;
    }else{
        let tweetInfo = (await getTimelineByUserID(268758461))[0];
        profileURL = tweetInfo.core.user_results.result.legacy.profile_image_url_https;
        return profileURL;
    }
}

// translateTextDeepL('ja', 'ko', `【ご報告】
// 僕が裁判で訴えている相手の方から、自分も訴え返されたりしているのですが、「告訴状がきたら警察は受理して捜査する義務があるのです」と警察の方よりうかがいましたし、ご心配にはおよびません！（当たり前だけど逮捕されたりもしないよ）
// 自分が話したことはもちろん根拠も証拠もありますし、自分が起こした裁判等もつつがなく進行しているのでご安心ください！
// 情報開示の裁判は簡単には通らないので、開示されたなら違法であるケースが多いと弁護士さんから聞いてます。

// 今回は心配してくれる方が多くいらしたので触れました！
// またこんな暗い話題を申し訳ないです...
// たくさん時間はかかると思うけど、決着がついたら報告するね！`).then(console.log);

module.exports = { checkNewTweet, getProfileURL, sendRecentTweet };