/* ===== 마후 트윗 번역봇 재가동!! ===== */
let cheerio = require('cheerio')
const path = require('path')
const deepl = require('deepl-node');
const appRoot = require('app-root-path').path;
require('dotenv').config({
    path: path.join(appRoot, '.env')
});
const fs = require('fs')
const { MessageBuilder } = require('discord-webhook-node');
const DEBUG = false;
const webhookManager = require('./webhookManager');

let profileURL = '';
let prevLastTweetID = 0;
if(fs.existsSync('./lastTweet.txt')) prevLastTweetID = BigInt(fs.readFileSync('./lastTweet.txt'));
else fs.writeFileSync('./lastTweet.txt', '0');


function convertToHalf(e) {
    return e.replace(/[！-～]/g, (halfwidthChar) =>
      String.fromCharCode(halfwidthChar.charCodeAt(0) - 0xfee0)
    );
}

/**
 * 번역 (DeepL 번역)
 * @param {string} source 번역할 언어(auto: 자동인식)
 * @param {string} target 번역될 언어
 * @param {string} query 번역할 텍스트
 */
async function translateTextDeepL(source, target, query) {
    const translator = new deepl.Translator(process.env.DEEPL_API_KEY);
    const response = await translator.translateText(convertToHalf(query), (source == 'auto' || !!source) ? source : null, target, {
        glossary: '0e46d5a2-c745-41c7-8ccd-d29b986de309'
    });

    return response.text;
}

/**
 * userID 트위터 타임라인 반환
 * @param {string} userID 사용자 ID
 * @param {string} authToken 사용자 로그인 토큰(쿠키 auth_token, 제대로된 작동 위해 필요)
 */
async function getTimelineByUserID(userID, authToken) {
    if(!!!authToken)
        console.warn('authToken is undefined. new tweet may not detect');
    
    let response = await (await fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(userID)}?hl=kr`, {
        method: 'GET',
        headers: {
            'Cookie': `auth_token=${authToken};`
        }
    })).text()
    let $ = cheerio.load(response);

    // is_quote_status: 인용 여부
    // quoted_status: 인용 트윗 내용
    let twitterInfo = JSON.parse($('script#__NEXT_DATA__').html()).props.pageProps;
    let timeline = twitterInfo.timeline.entries;
    fs.writeFileSync('./timeline.json', JSON.stringify(timeline, null, 4));
    let last_tweet_id = twitterInfo.latest_tweet_id
    return {timeline, last_tweet_id};
}

/**
 * tweetInfo 데이터를 기반으로 Discord 훅 전송
 * @param {object} tweetInfo 트윗 정보 Object
 */
async function sendHook(tweetInfo) {
        // 트위터 본문
        let content = tweetInfo.content.tweet;
        let created_at = new Date(content.created_at);

        // DeepL 번역
        let translatedText = await translateTextDeepL('ja', 'ko', content.full_text);

        profileURL = content.user.profile_image_url_https;
        let originalLink = 'https://twitter.com/uni_mafumafu/status/' + content.id_str;

        // 인용 트윗 처리
        if(content?.is_quote_status) {
            translatedText += `\n\nhttps://twitter.com${content.quoted_status.permalink}`
        }
    
        // 번역된 문장을 메시지로 만든다.
	    // await hook.send('<@&757040827620130896>')
        let embed = new MessageBuilder()
            .setTitle('New Tweet Release!')
            .setURL(originalLink)
            .setFooter(originalLink, profileURL)
            .setTimestamp(created_at)
            .setDescription(translatedText.trim())
            .setColor('#1da1f2');
        
        if(!!content.entities.media.length) embed.setImage(content.entities.media[0].media_url_https);
        webhookManager.sendWebhook(embed, profileURL);
}

async function getProfileURL() {
    if(!!profileURL) {
        return profileURL;
    }else{
        let tweetInfo = await getTimelineByUserID('uni_mafumafu', process.env.TWITTER_TOKEN_KEY);
        profileURL = tweetInfo.timeline[0].content.tweet.user.profile_image_url_https;
        return profile;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 새 트윗 감지
 */
async function checkNewTweet() {
    let timelineInfo = await getTimelineByUserID('uni_mafumafu', process.env.TWITTER_TOKEN_KEY);
    let lastTweetID = BigInt(timelineInfo.last_tweet_id);

    if(lastTweetID > prevLastTweetID || DEBUG) {
        let newTweets = timelineInfo.timeline.filter(e => {
            let id = BigInt(e.content.tweet.id_str);
            return id > prevLastTweetID
        }).reverse();
        prevLastTweetID = lastTweetID;
        fs.writeFileSync('./lastTweet.txt', String(lastTweetID));
        console.log(`[${new Date().toLocaleString('ja')}] ${newTweets.length} new tweet detect`);
        for(let i = 0; i < newTweets.length; i++) {
            await sendHook(newTweets[i]);
            await sleep(1500);
        }
    }
}

async function sendRecentTweet() {
    let timelineInfo = (await getTimelineByUserID('uni_mafumafu', process.env.TWITTER_TOKEN_KEY)).timeline;
    await sendHook(timelineInfo[0]);
}

module.exports = { checkNewTweet, getProfileURL, sendRecentTweet };