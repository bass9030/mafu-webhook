// X 내부 GraphQL API 클라이언트 (쿠키 인증: TWITTER_AUTH_TOKEN, TWITTER_CT0)
const { default_features, default_variables } = require("../twitterFeatures");
const {
    ClientTransaction,
    fetchXDocument,
} = require("x-client-transaction-id");
const { sendErrorLog, sendResponseDataLog } = require("../DebugLogger");
const { parseTimeline } = require("./parseTimeline");

const TIMELINE_PATH =
    "/i/api/graphql/FmuxExUC21Xn_C2NwtX5sQ/UserTweetsAndReplies";
// X 웹 클라이언트의 공개 Bearer 토큰
const BEARER_TOKEN =
    "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/**
 * @type {ClientTransaction}
 */
let transaction = null;

/**
 *
 * @param {BigInt|String} userId userId is not username!!
 */
async function getTimelineByUserID(userId, count) {
    const reqURL = `https://x.com${TIMELINE_PATH}?variables=${encodeURIComponent(
        JSON.stringify(
            Object.assign(default_variables, { userId: userId, count: count }),
        ),
    )}&features=${encodeURIComponent(JSON.stringify(default_features))}`;

    try {
        if (!transaction) {
            const document = await fetchXDocument();
            transaction = await ClientTransaction.create(document);
        }

        const transactionId = await transaction.generateTransactionId(
            "GET",
            TIMELINE_PATH,
        );

        let response = await fetch(reqURL, {
            method: "GET",
            headers: {
                referer: "https://x.com/",
                cookie: `auth_token=${process.env.TWITTER_AUTH_TOKEN}; ct0=${process.env.TWITTER_CT0};`,
                authorization: BEARER_TOKEN,
                "user-agent": USER_AGENT,
                "x-csrf-token": process.env.TWITTER_CT0,
                "x-twitter-active-user": "yes",
                "x-twitter-client-language": "en",
                "x-client-transaction-id": transactionId,
            },
        });
        let res_text = "";
        try {
            if (!response.ok) {
                throw new Error(
                    `Twitter API response not ok: ${response.status} ${response.statusText}`,
                );
            }
            res_text = await response.text();
            const res_json = JSON.parse(res_text);
            return parseTimeline(res_json);
        } catch (e) {
            sendErrorLog(e);
            sendResponseDataLog(res_text);
            throw e;
        }
    } catch (e) {
        // 주의: res_text는 이 블록에서 보이지 않아 ReferenceError가 대신 던져짐 (기존 동작)
        sendErrorLog(e);
        sendResponseDataLog(res_text);
        throw e;
    }
}

module.exports = {
    getTimelineByUserID,
};
