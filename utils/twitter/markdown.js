// 트윗 → 번역된 Discord 마크다운
const translateText = require("../translator");

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

module.exports = {
    MAX_TWEET_DEPTH,
    getTweetText,
    formatAuthor,
    toBlockquote,
    generateTweetMarkdown,
};
