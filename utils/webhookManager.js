const { pool } = require("./db");
const { sendErrorLog, sendInfoLog } = require("./DebugLogger");
const { WEBHOOK_TYPE } = require("./constants");
const {
    createWebhookClient,
    buildMention,
    buildWebhookPayload,
} = require("./discordSender");

class WebhookNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = "WebhookNotFoundError";
    }
}

class WebhookManager {
    constructor() {
        this.db = null;
    }

    async getConnection() {
        this.db = await pool.getConnection();
    }

    async releaseConnection() {
        if (!!this.db) await this.db.release();
        this.db = null;
    }

    /**
     * 커넥션을 받은 새 인스턴스로 fn을 실행하고, 성공/실패와 관계없이 커넥션을 반환
     * fn 안에서 await 하지 않은 쿼리는 반환 전에 발행만 되어 있으면 계속 진행됨
     * @template T
     * @param {(manager: WebhookManager) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    static async withConnection(fn) {
        const manager = new WebhookManager();
        await manager.getConnection();
        try {
            return await fn(manager);
        } finally {
            await manager.releaseConnection();
        }
    }

    async setLastTweetID(id) {
        await this.db.query(
            "REPLACE INTO lastTweet (key_str, id) VALUES (?, ?);",
            ["tweetID", id],
        );
    }

    async getLastTweetID() {
        try {
            let result = await this.db.query("SELECT * FROM lastTweet;");
            return result[0]["id"];
        } catch (err) {
            return null;
        }
    }

    static getOptions(optionNumber) {
        // 00000111
        // 3rd bit - isLINESend
        // 2nd bit - isNotiSend
        // 1st bit - isMention
        let optionBit = optionNumber.toString(2).padStart(8, "0");
        let isLINESend = optionBit[5] == "1";
        let isNotiSend = optionBit[6] == "1";
        let isMention = optionBit[7] == "1";

        return {
            isLINESend,
            isNotiSend,
            isMention,
        };
    }

    static setOptions(isLINESend, isNotiSend, isMention) {
        let bit = `${isLINESend ? "1" : "0"}${isNotiSend ? "1" : "0"}${
            isMention ? "1" : "0"
        }`.padStart(8, "0");
        return parseInt(bit, 2);
    }

    async addWebhook(channelID, webhookToken, options, roleID) {
        await this.db.query(
            "INSERT INTO webhooks (channelID, webhookToken, options, roleID) VALUES (?, ?, ?, ?);",
            [channelID, webhookToken, options, roleID],
        );
    }

    async removeWebhook(channelID, webhookToken) {
        let result = await this.db.query(
            "DELETE FROM webhooks WHERE channelID = ? AND webhookToken = ?;",
            [channelID, webhookToken],
        );
        if (result.affectedRows == 0) throw new WebhookNotFoundError();
    }

    async editWebhook(channelID, webhookToken, options, roleID) {
        let result = await this.db.query(
            "UPDATE webhooks SET roleID = ?, options = ? WHERE channelID = ? AND webhookToken = ?;",
            [roleID, options, channelID, webhookToken],
        );
        if (result.affectedRows == 0) throw new WebhookNotFoundError();
    }

    async getWebhookCount() {
        let count = await this.db.query("SELECT COUNT(*) FROM webhooks;");
        return count[0]["COUNT(*)"];
    }

    async sendNotice(title, content) {
        function getFullTimestamp(date) {
            return `${date.getFullYear()}-${
                date.getMonth() + 1
            }-${date.getDate()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
        }

        let now = new Date();
        await this.db.query(
            "INSERT INTO notices (date, title, content) VALUES (?, ?, ?);",
            [getFullTimestamp(now), title, content],
        );
        this.sendWebhook({ title, content }, WEBHOOK_TYPE.NOTI);
    }

    async getNotices() {
        try {
            let result = await this.db.query(
                "SELECT date, title, content FROM notices ORDER BY date DESC LIMIT 10",
            );

            return result;
        } catch (e) {
            return [];
        }
    }

    /**
     * @param {import("discord.js").EmbedBuilder[] | {title: string, content: string}} message
     * @param {WEBHOOK_TYPE} type
     */
    async sendWebhook(message, type = WEBHOOK_TYPE.TWITTER) {
        let err_cnt = 0;
        let success_cnt = 0;
        const webhooks =
            type == WEBHOOK_TYPE.TWITTER
                ? await this.db.query("SELECT * FROM webhooks;")
                : await this.db.query(
                      "SELECT * FROM webhooks WHERE options & ? = ?;",
                      [type, type],
                  );
        for (let i = 0; i < webhooks.length; i++) {
            let e = webhooks[i];
            try {
                const hook = createWebhookClient(e.channelID, e.webhookToken);
                let webhookOptions = WebhookManager.getOptions(e.options);
                let mention = webhookOptions.isMention
                    ? buildMention(e.roleID)
                    : "";
                const payload = buildWebhookPayload(message, type, mention);
                if (payload) await hook.send(payload);
                success_cnt++;
            } catch (err) {
                err_cnt++;
                sendErrorLog(err);
                // console.error(`Failed to send webhook to ${e.webhookURL}`);
                // console.error(err);
            }
        }
        sendInfoLog(
            `Webhook sended. \n` +
                `Total: ${webhooks.length} | Success: ${success_cnt} | Fail: ${err_cnt}`,
        );
    }
}

module.exports = {
    WebhookManager,
    WebhookNotFoundError,
    WEBHOOK_TYPE,
};
