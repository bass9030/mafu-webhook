import mariadb, { type PoolConnection, type UpsertResult } from "mariadb";
import { EmbedBuilder, WebhookClient } from "discord.js";
import type {
    Notice,
    NoticeMessage,
    WebhookOptions,
    WebhookRow,
} from "../types/domain";
import { sendErrorLog, sendInfoLog } from "./DebugLogger";

export enum WebhookType {
    TWITTER = 0,
    NOTI = 2,
    LINE = 4,
}

const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    port: 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 30,
});

export class WebhookNotFoundError extends Error {
    constructor(message = "Webhook not found") {
        super(message);
        this.name = "WebhookNotFoundError";
    }
}

function onExit(): void {
    void pool.end().finally(() => process.exit(0));
}

process.once("SIGTERM", onExit);
process.once("SIGINT", onExit);

export class WebhookManager {
    private db: PoolConnection | null = null;

    async getConnection(): Promise<void> {
        if (this.db) {
            throw new Error("Database connection is already acquired");
        }
        this.db = await pool.getConnection();
    }

    async releaseConnection(): Promise<void> {
        this.db?.release();
        this.db = null;
    }

    private connection(): PoolConnection {
        if (!this.db) {
            throw new Error("Database connection has not been acquired");
        }
        return this.db;
    }

    async setLastTweetID(id: string): Promise<void> {
        await this.connection().query(
            "REPLACE INTO lastTweet (key_str, id) VALUES (?, ?);",
            ["tweetID", id],
        );
    }

    async getLastTweetID(): Promise<string | null> {
        const rows = await this.connection().query<Array<{ id: string }>>(
            "SELECT id FROM lastTweet WHERE key_str = ? LIMIT 1;",
            ["tweetID"],
        );
        return rows[0]?.id ?? null;
    }

    static getOptions(optionNumber: number): WebhookOptions {
        return {
            isLINESend: (optionNumber & WebhookType.LINE) !== 0,
            isNotiSend: (optionNumber & WebhookType.NOTI) !== 0,
            isMention: (optionNumber & 1) !== 0,
        };
    }

    static setOptions(
        isLINESend: boolean,
        isNotiSend: boolean,
        isMention: boolean,
    ): number {
        return (
            (isLINESend ? WebhookType.LINE : 0) |
            (isNotiSend ? WebhookType.NOTI : 0) |
            (isMention ? 1 : 0)
        );
    }

    async addWebhook(
        channelID: string,
        webhookToken: string,
        options: number,
        roleID: string | number,
    ): Promise<void> {
        await this.connection().query(
            "INSERT INTO webhooks (channelID, webhookToken, options, roleID) VALUES (?, ?, ?, ?);",
            [channelID, webhookToken, options, roleID],
        );
    }

    async removeWebhook(channelID: string, webhookToken: string): Promise<void> {
        const result = await this.connection().query<UpsertResult>(
            "DELETE FROM webhooks WHERE channelID = ? AND webhookToken = ?;",
            [channelID, webhookToken],
        );
        if (result.affectedRows === 0) throw new WebhookNotFoundError();
    }

    async editWebhook(
        channelID: string,
        webhookToken: string,
        options: number,
        roleID: string | number,
    ): Promise<void> {
        const result = await this.connection().query<UpsertResult>(
            "UPDATE webhooks SET roleID = ?, options = ? WHERE channelID = ? AND webhookToken = ?;",
            [roleID, options, channelID, webhookToken],
        );
        if (result.affectedRows === 0) throw new WebhookNotFoundError();
    }

    async getWebhookCount(): Promise<number> {
        const rows = await this.connection().query<Array<{ count: number }>>(
            "SELECT COUNT(*) AS count FROM webhooks;",
        );
        return Number(rows[0]?.count ?? 0);
    }

    async sendNotice(title: string, content: string): Promise<void> {
        const now = new Date();
        await this.connection().query(
            "INSERT INTO notices (date, title, content) VALUES (?, ?, ?);",
            [now, title, content],
        );
        await this.sendWebhook({ title, content }, WebhookType.NOTI);
    }

    async getNotices(): Promise<Notice[]> {
        return this.connection().query<Notice[]>(
            "SELECT date, title, content FROM notices ORDER BY date DESC LIMIT 10",
        );
    }

    async sendWebhook(
        message: EmbedBuilder | NoticeMessage,
        type: WebhookType = WebhookType.TWITTER,
    ): Promise<void> {
        const webhooks =
            type === WebhookType.TWITTER
                ? await this.connection().query<WebhookRow[]>(
                      "SELECT channelID, webhookToken, options, roleID FROM webhooks;",
                  )
                : await this.connection().query<WebhookRow[]>(
                      "SELECT channelID, webhookToken, options, roleID FROM webhooks WHERE options & ? = ?;",
                      [type, type],
                  );

        let failed = 0;
        for (const webhook of webhooks) {
            try {
                await this.sendOneWebhook(webhook, message, type);
            } catch (error) {
                failed += 1;
                sendErrorLog(error);
            }
        }
        sendInfoLog(
            `Webhook sent. Total: ${webhooks.length} | Success: ${webhooks.length - failed} | Fail: ${failed}`,
        );
    }

    private async sendOneWebhook(
        webhook: WebhookRow,
        message: EmbedBuilder | NoticeMessage,
        type: WebhookType,
    ): Promise<void> {
        const client = new WebhookClient({
            id: webhook.channelID,
            token: webhook.webhookToken,
        });
        const options = WebhookManager.getOptions(webhook.options);
        const roleID = String(webhook.roleID);
        const mention = options.isMention
            ? roleID === "@everyone" || roleID === "@here"
                ? roleID
                : roleID !== "-1"
                  ? `<@&${roleID}>`
                  : ""
            : "";

        const embed =
            type === WebhookType.NOTI
                ? new EmbedBuilder()
                      .setTitle("마훅 공지사항")
                      .setFields({
                          name: (message as NoticeMessage).title,
                          value: (message as NoticeMessage).content,
                      })
                      .setColor(4037805)
                : (message as EmbedBuilder);
        const avatarURL =
            type === WebhookType.NOTI
                ? "https://mahook.bass9030.dev/logo.png"
                : embed.data.footer?.icon_url;

        await client.send({
            avatarURL,
            username: "마훅 - 마후 트윗 번역봇",
            content: mention,
            embeds: [embed],
        });
    }
}
