import { createHash } from "node:crypto";
import createError from "http-errors";
import { EmbedBuilder, WebhookClient } from "discord.js";
import { Router, type Request, type Response } from "express";
import type { ApiResponse, Notice } from "../types/domain";
import { sendErrorLog } from "../utils/DebugLogger";
import { getProfileURL, sendRecentTweet } from "../utils/getTweet";
import { LineSignatureVerifier } from "../utils/lineSignature";
import { sendHook } from "../utils/sendLINE";
import {
    WebhookManager,
    WebhookNotFoundError,
} from "../utils/webhookManager";

interface WebhookRequestBody {
    url?: unknown;
    roleID?: unknown;
    options?: unknown;
}

interface ParsedWebhook {
    channelID: string;
    webhookToken: string;
    roleID: string | number;
    options: number;
}

const router = Router();
const webhookRegex = /^https:\/\/discord(?:app)?\.com\/api\/webhooks\/([0-9]+)\/([A-Za-z0-9_.-]+)\/?$/;
const roleRegex = /^(?:@everyone|@here|[0-9]+|-1)$/;
let lineSignatureVerifier: LineSignatureVerifier | undefined;

function parseWebhook(body: WebhookRequestBody): ParsedWebhook | null {
    if (
        typeof body.url !== "string" ||
        !roleRegex.test(String(body.roleID)) ||
        typeof body.options !== "number" ||
        !Number.isInteger(body.options) ||
        body.options < 0 ||
        body.options > 7
    ) {
        return null;
    }
    const match = webhookRegex.exec(body.url);
    if (!match?.[1] || !match[2]) return null;
    return {
        channelID: match[1],
        webhookToken: match[2],
        roleID: body.roleID as string | number,
        options: body.options,
    };
}

async function withManager<T>(
    operation: (manager: WebhookManager) => Promise<T>,
): Promise<T> {
    const manager = new WebhookManager();
    await manager.getConnection();
    try {
        return await operation(manager);
    } finally {
        await manager.releaseConnection();
    }
}

function errorDetails(error: unknown): { errno?: number; code?: number; status?: number } {
    return typeof error === "object" && error !== null ? error : {};
}

router.post(
    "/register",
    async (request: Request<object, ApiResponse, WebhookRequestBody>, response) => {
        const webhook = parseWebhook(request.body);
        if (!webhook) {
            response.status(400).json({
                status: 400,
                message: "웹후크 URL, 역할 ID 또는 옵션이 올바르지 않습니다.",
            });
            return;
        }
        try {
            const embed = new EmbedBuilder()
                .setTitle("마훅 구독 완료!")
                .setDescription(
                    "마훅 구독이 완료되었습니다!\n이제부터 마후마후 트윗을 한국어로 즐겨보세요!",
                )
                .setColor(0x1da1f2);
            await new WebhookClient({
                id: webhook.channelID,
                token: webhook.webhookToken,
            }).send({
                username: "마훅 - 마후 트윗 번역봇",
                avatarURL: await getProfileURL(),
                embeds: [embed],
            });
            await withManager((manager) =>
                manager.addWebhook(
                    webhook.channelID,
                    webhook.webhookToken,
                    webhook.options,
                    webhook.roleID,
                ),
            );
            response.json({ status: 200 });
        } catch (error) {
            const details = errorDetails(error);
            if (details.errno === 1062) {
                response.status(409).json({ status: 409, message: "이미 등록된 웹후크 URL 입니다." });
            } else if (details.code === 10015 || details.status === 404) {
                response.status(400).json({ status: 400, message: "올바르지 않은 웹후크 URL 입니다." });
            } else {
                sendErrorLog(error);
                response.status(500).json({ status: 500 });
            }
        }
    },
);

router.post(
    "/edit",
    async (request: Request<object, ApiResponse, WebhookRequestBody>, response) => {
        const webhook = parseWebhook(request.body);
        if (!webhook) {
            response.status(400).json({ status: 400, message: "입력값이 올바르지 않습니다." });
            return;
        }
        try {
            await withManager((manager) =>
                manager.editWebhook(
                    webhook.channelID,
                    webhook.webhookToken,
                    webhook.options,
                    webhook.roleID,
                ),
            );
            response.json({ status: 200 });
        } catch (error) {
            handleManagerError(error, response);
        }
    },
);

router.delete("/unregister", async (request, response: Response<ApiResponse>) => {
    const url = typeof request.query.url === "string" ? request.query.url : "";
    const match = webhookRegex.exec(url);
    if (!match?.[1] || !match[2]) {
        response.status(400).json({ status: 400 });
        return;
    }
    try {
        await withManager((manager) => manager.removeWebhook(match[1]!, match[2]!));
        response.json({ status: 200 });
    } catch (error) {
        handleManagerError(error, response);
    }
});

router.get("/getNotices", async (_request, response: Response<ApiResponse<Notice[]>>) => {
    try {
        const data = await withManager((manager) => manager.getNotices());
        response.json({ status: 200, data });
    } catch (error) {
        sendErrorLog(error);
        response.status(500).json({ status: 500 });
    }
});

router.post("/sendNoti", async (request, response: Response<ApiResponse | string>) => {
    const token = request.body?.["amazing-something"];
    const expected = process.env.NOTICE_TOKEN_KEY;
    if (typeof token !== "string" || !expected) {
        response.status(403).json({ status: 403 });
        return;
    }
    const digest = createHash("sha512").update(token).digest("hex");
    if (digest !== expected.toLowerCase()) {
        response.status(403).json({ status: 403 });
        return;
    }
    const { title, content } = request.body as Record<string, unknown>;
    if (typeof title !== "string" || typeof content !== "string") {
        response.status(400).json({ status: 400 });
        return;
    }
    try {
        await withManager((manager) => manager.sendNotice(title, content));
        response.send("공지 전송 성공!");
    } catch (error) {
        sendErrorLog(error);
        response.status(500).json({ status: 500 });
    }
});

router.get("/testWebhook", async (request, response, next) => {
    if (request.app.get("env") !== "development") return next(createError(404));
    try {
        await sendRecentTweet(typeof request.query.id === "string" ? request.query.id : undefined);
        response.send("웹훅 전송 성공");
    } catch (error) {
        sendErrorLog(error);
        response.status(500).send("웹훅 전송 실패");
    }
});

router.post("/line-webhook", async (request, response) => {
    const rawBody = (request as typeof request & { rawBody?: Buffer }).rawBody;
    const timestamp = request.get("x-timestamp");
    const nonce = request.get("x-nonce");
    const contentDigest = request.get("content-digest");
    const signature = request.get("x-signature");
    if (!rawBody || !timestamp || !nonce || !contentDigest || !signature) {
        response.status(401).json({ status: 401 });
        return;
    }
    try {
        const verifier = getLineSignatureVerifier();
        const isValid = verifier.verify({
            method: request.method,
            path: request.originalUrl.split("?", 1)[0]!,
            rawBody,
            headers: {
                keyId: request.get("x-key-id"),
                timestamp,
                nonce,
                contentDigest,
                signature,
            },
        });
        if (!isValid) {
            response.status(401).json({ status: 401 });
            return;
        }
    } catch (error) {
        sendErrorLog(error);
        response.status(500).json({ status: 500 });
        return;
    }
    const body = request.body as { time?: unknown; content?: unknown };
    if ((typeof body.time !== "string" && typeof body.time !== "number") || typeof body.content !== "string") {
        response.status(400).json({ status: 400 });
        return;
    }
    try {
        await sendHook({ time: body.time, message: body.content });
        response.json({ status: 200 });
    } catch (error) {
        sendErrorLog(error);
        response.status(500).json({ status: 500 });
    }
});

function getLineSignatureVerifier(): LineSignatureVerifier {
    if (lineSignatureVerifier) return lineSignatureVerifier;
    const publicKey = process.env.LINE_SIGNING_PUBLIC_KEY;
    if (!publicKey) throw new Error("LINE_SIGNING_PUBLIC_KEY is required");
    lineSignatureVerifier = new LineSignatureVerifier(publicKey, {
        keyId: process.env.LINE_SIGNING_KEY_ID,
    });
    return lineSignatureVerifier;
}

function handleManagerError(error: unknown, response: Response<ApiResponse>): void {
    if (error instanceof WebhookNotFoundError) {
        response.status(404).json({ status: 404, message: "웹후크를 찾을 수 없습니다." });
    } else {
        sendErrorLog(error);
        response.status(500).json({ status: 500 });
    }
}

export default router;
