// 테스트용 트윗 객체 생성기 (X GraphQL 응답의 tweet_results.result 형태 중 코드가 쓰는 필드만)

function user(screenName = "uni_mafumafu", name = "まふまふ") {
    return {
        result: {
            avatar: { image_url: `https://pbs.twimg.com/${screenName}.jpg` },
            core: { name, screen_name: screenName },
        },
    };
}

/**
 * @param {object} o
 * @param {string} o.id
 * @param {string} [o.text]
 * @param {string} [o.screenName]
 * @param {string} [o.name]
 * @param {object[]} [o.media]
 * @param {object[]} [o.urls]
 * @param {object} [o.retweeted] 트윗 객체
 * @param {object} [o.quoted] 트윗 객체
 * @param {{id: string, screenName: string}} [o.replyTo]
 * @param {string} [o.createdAt]
 */
function tweet(o) {
    const t = {
        __typename: "Tweet",
        rest_id: o.id,
        core: { user_results: user(o.screenName, o.name) },
        legacy: {
            id_str: o.id,
            created_at: o.createdAt ?? "Tue Oct 27 09:05:00 +0000 2026",
            full_text: o.text ?? `text-${o.id}`,
            entities: {
                urls: o.urls ?? [],
                ...(o.media ? { media: o.media } : {}),
            },
        },
    };
    if (o.retweeted) t.legacy.retweeted_status_result = { result: o.retweeted };
    if (o.quoted) t.quoted_status_result = { result: o.quoted };
    if (o.replyTo) {
        t.legacy.in_reply_to_status_id_str = o.replyTo.id;
        t.legacy.in_reply_to_screen_name = o.replyTo.screenName;
    }
    return t;
}

function media(type, n, url = "https://t.co/media") {
    return { type, url, media_url_https: `https://pbs.twimg.com/media/${type}-${n}.jpg` };
}

/** X UserTweetsAndReplies 응답 형태 생성 */
function timelineResponse(entries) {
    return {
        data: {
            user: {
                result: {
                    timeline: {
                        timeline: {
                            instructions: [
                                { type: "TimelineClearCache" },
                                { type: "TimelineAddEntries", entries },
                            ],
                        },
                    },
                },
            },
        },
    };
}

function tweetEntry(t) {
    return {
        entryId: `tweet-${t.rest_id}`,
        content: { itemContent: { tweet_results: { result: t } } },
    };
}

module.exports = { tweet, media, user, timelineResponse, tweetEntry };
