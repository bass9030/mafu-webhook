const { MAFU_SCREEN_NAME } = require("../constants");

/**
 * 마후마후가 작성한 트윗인지 확인
 * 작성자 정보가 없는 결과(삭제된 트윗 TweetTombstone 등)는 false
 * @param {object} tweet tweet_results.result
 */
function isMafuTweet(tweet) {
    return (
        tweet?.core?.user_results?.result?.core?.screen_name == MAFU_SCREEN_NAME
    );
}

/**
 * UserTweetsAndReplies 응답에서 마후마후 트윗 목록 추출 (ID 내림차순)
 * - tweet-*: 단독 트윗/RT (content.itemContent)
 * - profile-conversation-*: 답글 대화 묶음 (content.items, 다른 사람 트윗이 섞여 있음)
 * 작성자 검사는 엔트리가 아닌 트윗 단위로 함
 * 응답 구조가 예상과 다르면 예외를 던짐
 * @param {object} res_json X GraphQL 응답
 * @returns {object[]} tweet_results.result 배열
 */
function parseTimeline(res_json) {
    let tweets =
        res_json.data.user.result.timeline.timeline.instructions
            .filter((e) => e.type == "TimelineAddEntries")[0]
            .entries.filter((e) => {
                return (
                    e.entryId.match(/^profile\-conversation\-[0-9]+/g) ||
                    e.entryId.match(/^tweet\-[0-9]+/g)
                );
            });

    let data = [];
    for (let i = 0; i < tweets.length; i++) {
        let e = tweets[i];

        if (e.entryId.match(/^tweet\-[0-9]+/g)) {
            // 일반 트윗
            const tweet = e.content.itemContent.tweet_results.result;
            if (isMafuTweet(tweet)) data.push(tweet);
        } else if (e.entryId.match(/^profile\-conversation\-[0-9]+/g)) {
            // 타래(대화 묶음) 트윗: 다른 사람의 원글/답글은 제외
            for (let j = 0; j < e.content.items.length; j++) {
                let f = e.content.items[j];
                if (
                    f.entryId.match(
                        /^profile\-conversation\-[0-9]+\-tweet\-[0-9]+/g,
                    )
                ) {
                    const tweet = f.item.itemContent.tweet_results.result;
                    if (isMafuTweet(tweet)) data.push(tweet);
                }
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
}

module.exports = {
    parseTimeline,
};
