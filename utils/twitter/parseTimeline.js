const { MAFU_SCREEN_NAME } = require("../constants");

/**
 * UserTweetsAndReplies 응답에서 마후마후 트윗 목록 추출 (ID 내림차순)
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

        // 마후마후 트윗만 필터링
        if (
            e.content.itemContent.tweet_results.result.core.user_results.result
                .core.screen_name != MAFU_SCREEN_NAME
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
}

module.exports = {
    parseTimeline,
};
