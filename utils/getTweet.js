const DEBUG = false;
const { WebhookManager, WEBHOOK_TYPE } = require("./webhookManager");
const {
    sendErrorLog,
    sendInfoLog,
    sendResponseDataLog,
} = require("./DebugLogger");
const { MAFU_USER_ID } = require("./constants");
const { getTimelineByUserID } = require("./twitter/client");
const { getWebhookEmbed } = require("./twitter/embed");
const { getProfileURL } = require("./twitter/profile");
const {
    getTweetText,
    formatAuthor,
    toBlockquote,
    generateTweetMarkdown,
} = require("./twitter/markdown");

let prevLastTweetID = null;

/**
 * 새 트윗 감지
 */
async function checkNewTweet() {
    const webhookManager = new WebhookManager();
    await webhookManager.getConnection();
    if (!!!prevLastTweetID) {
        prevLastTweetID = await webhookManager.getLastTweetID();
        if (!!!prevLastTweetID) {
            await webhookManager.setLastTweetID(0);
            prevLastTweetID = 0;
        }
    }

    let timelineInfo;
    try {
        timelineInfo = await getTimelineByUserID(MAFU_USER_ID);
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
            sendInfoLog(`${newTweets.length} new tweet detect`);
            if ((await webhookManager.getWebhookCount()) < 1) {
                console.log("No user found. Ignored");
                return;
            }
            for (let i = 0; i < newTweets.length; i++) {
                try {
                    const embed = await getWebhookEmbed(newTweets[i]);
                    await webhookManager.sendWebhook(embed);
                } catch (e) {
                    sendErrorLog(e);
                }
            }
        }
    } catch (e) {
        sendErrorLog(e);
        sendResponseDataLog(JSON.stringify(timelineInfo));
    } finally {
        webhookManager.releaseConnection();
    }
}

async function sendRecentTweet(id) {
    let timelineInfo = await getTimelineByUserID(MAFU_USER_ID);
    await WebhookManager.withConnection(async (webhookManager) => {
        const embed = await getWebhookEmbed(
            !!id
                ? timelineInfo.filter((e) => e["rest_id"] == id)[0]
                : timelineInfo[0],
        );

        // 전송은 await 하지 않음 (기존 동작 유지)
        webhookManager.sendWebhook(embed, WEBHOOK_TYPE.TWITTER);
    });
}

module.exports = {
    checkNewTweet,
    getProfileURL,
    sendRecentTweet,
    getTimelineByUserID,
    // 테스트용 export
    getTweetText,
    formatAuthor,
    toBlockquote,
    generateTweetMarkdown,
    getWebhookEmbed,
};
