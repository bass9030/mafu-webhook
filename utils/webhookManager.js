const mariadb = require("mariadb");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const sendDebugLog = require("./DebugLogger");

/**
 * @typedef { Number } WEBHOOK_TYPES
 */
/**
 * @enum { WEBHOOK_TYPES } WEBHOOK_TYPE
 */
const WEBHOOK_TYPE = {
    TWITTER: 0,
    NOTI: 1,
    LINE: 2,
};

const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    port: 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 30,
});

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

    async setLastTweetID(id) {
        await this.db.query(
            "REPLACE INTO lastTweet (key_str, id) VALUES (?, ?);",
            ["tweetID", id]
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

    async sendWelcomeWebhook(channelID, webhookToken) {
        let embed = new EmbedBuilder();
        embed.setTitle("마훅 구독 완료!");
        embed.setDescription(
            "마훅 구독이 완료되었습니다!\n이제부터 마후마후 트윗을 한국어로 즐겨보세요!"
        );
        embed.setColor(0x1da1f2);

        let hook = new WebhookClient({ id: channelID, token: webhookToken });
        await hook.send({
            content: "",
            username: "마훅 - 마후 트윗 번역봇",
            avatarURL: await getProfileURL(),
            embeds: [embed],
        });
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
            [channelID, webhookToken, options, roleID]
        );
    }

    async removeWebhook(channelID, webhookToken) {
        let result = await this.db.query(
            "DELETE FROM webhooks WHERE channelID = ? AND webhookToken = ?;",
            [channelID, webhookToken]
        );
        if (result.affectedRows == 0) throw new WebhookNotFoundError();
    }

    async editWebhook(channelID, webhookToken, options, roleID) {
        let result = await this.db.query(
            "UPDATE webhooks SET roleID = ?, sendNoticeMessage = ? WHERE channelID = ? AND webhookToken = ?;",
            [roleID, options, channelID, webhookToken]
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
            [getFullTimestamp(now), title, content]
        );
        this.sendWebhook({ title, content }, WEBHOOK_TYPE.NOTI);
    }

    async getNotices() {
        try {
            let result = await this.db.query(
                "SELECT date, title, content FROM notices ORDER BY date DESC LIMIT 10"
            );

            return result;
        } catch (e) {
            return [];
        }
    }

    /**
     * @param {EmbedBuilder | object} message
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
                      [type, 2 ** type]
                  );
        for (let i = 0; i < webhooks.length; i++) {
            let e = webhooks[i];
            try {
                const hook = new WebhookClient({
                    id: e.channelID,
                    token: e.webhookToken,
                });
                let webhookOptions = WebhookManager.getOptions(e.options);
                let mention = "";
                if (webhookOptions.isMention) {
                    if (e.roleID != -1) {
                        if (e.roleID == "@everyone" || e.roleID == "@here")
                            mention = e.roleID;
                        else mention = "<@&" + e.roleID + ">";
                    }
                }
                let profileURL;
                switch (type) {
                    case WEBHOOK_TYPE.NOTI:
                        profileURL = "https://mahook.bass9030.dev/logo.png";
                        const embed = new EmbedBuilder();
                        embed.setTitle("마훅 공지사항");
                        embed.setFields({
                            name: message.title,
                            value: message.content,
                        });
                        embed.setColor(4037805);

                        await hook.send({
                            avatarURL: profileURL,
                            username: "마훅 - 마후 트윗 번역봇",
                            content: mention,
                            embeds: [embed],
                        });
                        break;
                    case WEBHOOK_TYPE.TWITTER:
                    case WEBHOOK_TYPE.LINE:
                        profileURL = message.data["footer"]["icon_url"];
                        await hook.send({
                            avatarURL: profileURL,
                            username: "마훅 - 마후 트윗 번역봇",
                            content: mention,
                            embeds: [message],
                        });
                        break;
                }
                success_cnt++;
            } catch (err) {
                err_cnt++;
                console.error(`Failed to send webhook to ${e.webhookURL}`);
                console.error(err);
            }
        }
        sendDebugLog(
            `Webhook sended. \n` +
                `Total: ${webhooks.length} | Success: ${success_cnt} | Fail: ${err_cnt}`
        );
    }
}

module.exports = {
    WebhookManager,
    WebhookNotFoundError,
    WEBHOOK_TYPE,
};
