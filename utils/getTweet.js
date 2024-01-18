/* ===== 마후 트윗 번역봇 재가동!! ===== */
let cheerio = require('cheerio')
require('dotenv').config({
    path: '../.env'
});
const fs = require('fs')
const { MessageBuilder } = require('discord-webhook-node');
let webhookURL = '';
const DEBUG = false;
const webhookManager = require('./webhookManager');

let prevLastTweetID;
if(fs.existsSync('./lastTweet.txt')) prevLastTweetID = BigInt(fs.readFileSync('./lastTweet.txt'));

/**
 * 번역 (Kakao I 번역)
 * @param {string} source 번역할 언어(auto: 자동인식)
 * @param {string} target 번역될 언어
 * @param {string} query 번역할 텍스트
 */
async function translateTextKakaoI(source, target, query) {
    let reqBody = new FormData();
    reqBody.append('queryLanguage', source);
    reqBody.append('targetLanguage', target);
    reqBody.append('q', query);
    let response = (await (await fetch('https://translate.kakao.com/translator/translate.json', {
        method: 'POST',
        headers: {
            'Referer': 'https://translate.kakao.com/'
        },
        body: reqBody
    })).json()).result.output

    let originalTextArr = source.split('\n');
    let translatedText = '';
    let translateIdx = 0;
    for(let i = 0; i < originalTextArr.length; i++) {
        if(!!originalTextArr[i].trim()) {
            translatedText += response[translateIdx] + '\n';
            translateIdx++;
        }else translatedText += '\n';
    }

    return translatedText;
}

/**
 * 번역 (DeepL 번역)
 * @param {string} source 번역할 언어(auto: 자동인식)
 * @param {string} target 번역될 언어
 * @param {string} query 번역할 텍스트
 */
async function translateTextDeepL(source, target, query) {
    let reqBody = new FormData();
    if(source == 'auto' || !!source) reqBody.append('sourge_lang', source);
    reqBody.append('target_lang', target);
    reqBody.append('text', query);
    let response = await (await fetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST',
        headers: {
            'Authorization': 'DeepL-Auth-Key ' + process.env.DEEPL_API_KEY
        },
        body: reqBody
    })).json()

    return response.translations[0].text;
}

/**
 * userID 트위터 타임라인 반환
 * @param {string} userID 사용자 ID
 * @param {string} authToekn 사용자 로그인 토큰(쿠키 auth_token, 제대로된 작동 위해 필요)
 */
async function getTimelineByUserID(userID, authToekn) {
    let response = await (await fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(userID)}?hl=kr`, {
        method: 'GET',
        headers: {
            'Cookie': `auth_token=${authToekn};`
        }
    })).text()
    let $ = cheerio.load(response);

    let twitterInfo = JSON.parse($('script#__NEXT_DATA__').html()).props.pageProps;
    let timeline = twitterInfo.timeline.entries;
    let last_tweet_id = twitterInfo.latest_tweet_id
    return {timeline, last_tweet_id};
}

/**
 * tweetInfo 데이터를 기반으로 Discord 훅 전송
 * @param {object} tweetInfo 트윗 정보 Object
 */
async function sendHook(tweetInfo) {
        // 트위터에서 본문을 읽어온다.
        let content = tweetInfo.content.tweet;

        let created_at = new Date(content.created_at);

        // Kakao i 번역
        // let translatedText = await translateText('auto', 'kr', content.full_text);

        // DeepL 번역
        let translatedText = await translateTextDeepL('auto', 'ko', content.full_text);

        const hook = new Webhook(webhookURL);
        hook.setAvatar(content.user.profile_image_url_https);
        hook.setUsername('마훅');
        let originalLink = 'https://twitter.com/uni_mafumafu/status/' + content.id_str;
    
        // 번역된 문장을 메시지로 만든다.
	    // await hook.send('<@&757040827620130896>')
        let embed = new MessageBuilder()
            .setTitle('New Tweet Release!')
            .setURL(originalLink)
            .setFooter(originalLink, content.user.profile_image_url_https)
            .setTimestamp(created_at)
            .setDescription(translatedText.trim())
            .setColor('#1da1f2');
    
        if(!!content.entities.media.length) embed.setImage(content.entities.media[0].media_url_https);
        // await hook.send(embed)
        webhookManager.sendWebhook(embed);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 새 트윗 감지
 */
async function checkNewTweet(webhookURL) {
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