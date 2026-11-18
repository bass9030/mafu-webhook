var express = require("express");
var router = express.Router();
const crypto = require("crypto");
const {
    WebhookManager,
    WebhookNotFoundError,
} = require("../utils/webhookManager");
var createError = require("http-errors");
const { getProfileURL, sendRecentTweet } = require("../utils/getTweet");
const {
    createWebhookClient,
    buildWelcomeEmbed,
} = require("../utils/discordSender");
const { LineSignatureVerifier } = require("../utils/lineSignature");
const { sendHook } = require("../utils/sendLINE");
const { sendErrorLog } = require("../utils/DebugLogger");
const { BOT_USERNAME } = require("../utils/constants");
const {
    parseWebhookUrl,
    isValidWebhookUrl,
    isValidRoleID,
} = require("../utils/webhookInput");
const MESSAGES = require("./messages");

router.post("/register", async function (req, res, next) {
    if (!!!req.body && !!!req.body?.url) {
        res.status(400).json({ status: res.statusCode });
        return;
    }

    let data = req.body;

    try {
        // role id check
        if (!isValidRoleID(data.roleID)) {
            res.status(400);
            res.json({
                status: res.statusCode,
                message: MESSAGES.INVALID_ROLE_ID,
            });
            return;
        }

        // webhook url check
        if (!isValidWebhookUrl(data.url)) {
            res.status(400);
            res.json({
                status: res.statusCode,
                message: MESSAGES.INVALID_WEBHOOK_URL,
            });
            return;
        }

        let { channelID, webhookToken } = parseWebhookUrl(data.url);

        let embed = buildWelcomeEmbed();

        let hook = createWebhookClient(channelID, webhookToken);

        await hook.send({
            content: "",
            username: BOT_USERNAME,
            avatarURL: await getProfileURL(),
            embeds: [embed],
        });

        await WebhookManager.withConnection(async (webhookManager) => {
            await webhookManager.addWebhook(
                channelID,
                webhookToken,
                data.options,
                data.roleID,
            );
            res.json({ status: res.statusCode });
        });
    } catch (e) {
        if (e.errno == 1062) {
            res.status(409);
            res.json({
                status: res.statusCode,
                message: MESSAGES.DUPLICATED_WEBHOOK,
            });
        } else if (e.code == 10015 || e.status == 404) {
            res.status(400);
            res.json({
                status: res.statusCode,
                message: MESSAGES.INVALID_WEBHOOK_URL,
            });
        } else {
            sendErrorLog(e);
            res.status(500);
            res.json({ status: res.statusCode });
        }
    }
});

router.post("/edit", async (req, res, next) => {
    let data = req.body;
    if (!!!req.body && !!!req.body?.url) {
        res.status(400).json({ status: res.statusCode });
        return;
    }

    if (!isValidRoleID(data.roleID)) {
        res.status(400);
        res.json({
            status: res.statusCode,
            message: MESSAGES.INVALID_ROLE_ID,
        });
        return;
    }

    try {
        let { channelID, webhookToken } = parseWebhookUrl(data.url);

        await WebhookManager.withConnection(async (webhookManager) => {
            await webhookManager.editWebhook(
                channelID,
                webhookToken,
                data.options,
                data.roleID,
            );
            res.json({ status: res.statusCode });
        });
    } catch (e) {
        if (e instanceof WebhookNotFoundError) {
            res.status(404);
            res.json({
                status: res.statusCode,
                message: MESSAGES.EDIT_WEBHOOK_NOT_FOUND,
            });
        } else {
            sendErrorLog(e);
            res.status(500);
            res.json({ status: res.statusCode });
        }
    }
});

router.delete("/unregister", async (req, res, next) => {
    let data = req.query;
    if (!!!req.query?.url) {
        res.status(400).json({ status: res.statusCode });
        return;
    }
    // try 밖에서 파싱: 형식 오류는 에러 핸들러(HTML 500)로 감 (현재 동작 유지)
    let { channelID, webhookToken } = parseWebhookUrl(data.url);
    try {
        await WebhookManager.withConnection(async (webhookManager) => {
            await webhookManager.removeWebhook(channelID, webhookToken);
            res.json({ status: res.statusCode });
        });
    } catch (e) {
        if (e instanceof WebhookNotFoundError) {
            res.status(404);
            res.json({
                status: res.statusCode,
                message: MESSAGES.UNREGISTER_WEBHOOK_NOT_FOUND,
            });
        } else {
            sendErrorLog(e);
            res.status(500);
            res.json({ status: res.statusCode });
        }
    }
});

router.get("/getNotices", async (req, res, next) => {
    try {
        await WebhookManager.withConnection(async (webhookManager) => {
            let data = await webhookManager.getNotices();
            res.json({ status: res.statusCode, data });
        });
    } catch (e) {
        sendErrorLog(e);
        res.status(500);
        res.json({ status: res.statusCode });
    }
});

router.post("/sendNoti", async (req, res, next) => {
    try {
        if (
            !!!req.body?.content ||
            !!!req.body?.title ||
            !!!req.body?.["amazing-something"]
        ) {
            res.status(400).json({ status: res.statusCode });
            return;
        }
        const hashedHeader = crypto
            .createHash("sha512")
            .update(req.body?.["amazing-something"])
            .digest("hex");
        if (hashedHeader == process.env.NOTICE_TOKEN_KEY.toLowerCase()) {
            await WebhookManager.withConnection(async (webhookManager) => {
                // sendNotice 내부의 공지 전송은 await 되지 않음 (응답 후 백그라운드로 진행)
                await webhookManager.sendNotice(
                    req.body?.title,
                    req.body?.content,
                );
                res.send(MESSAGES.NOTICE_SENT);
            });
        } else {
            res.status(403).json({ status: res.statusCode });
        }
    } catch (e) {
        sendErrorLog(e);
        res.status(500).json({ status: res.statusCode });
    }
});

router.get("/testWebhook", async (req, res, next) => {
    if (req.app.get("env") !== "development") {
        next(createError(404));
        return;
    }
    try {
        await sendRecentTweet(req.query.id);
        res.send(MESSAGES.TEST_WEBHOOK_SENT);
    } catch (e) {
        sendErrorLog(e);
        res.status(500).send(`<pre><code>${e.stack}</code></pre>`);
    }
});

/** @type {LineSignatureVerifier | undefined} */
let lineSignatureVerifier;

/** 환경 변수의 공개키로 검증기를 만든다. nonce 기록 유지를 위해 재사용한다 */
function getLineSignatureVerifier() {
    if (lineSignatureVerifier) return lineSignatureVerifier;
    const publicKey = process.env.LINE_SIGNING_PUBLIC_KEY;
    if (!publicKey) throw new Error("LINE_SIGNING_PUBLIC_KEY is required");
    lineSignatureVerifier = new LineSignatureVerifier(publicKey, {
        keyId: process.env.LINE_SIGNING_KEY_ID,
    });
    return lineSignatureVerifier;
}

router.post("/line-webhook", async (req, res) => {
    const rawBody = req.rawBody;
    const timestamp = req.get("x-timestamp");
    const nonce = req.get("x-nonce");
    const contentDigest = req.get("content-digest");
    const signature = req.get("x-signature");
    if (!rawBody || !timestamp || !nonce || !contentDigest || !signature) {
        res.status(401).json({ status: res.statusCode });
        return;
    }

    let isValid;
    try {
        isValid = getLineSignatureVerifier().verify({
            method: req.method,
            path: req.originalUrl.split("?", 1)[0],
            rawBody,
            headers: {
                keyId: req.get("x-key-id"),
                timestamp,
                nonce,
                contentDigest,
                signature,
            },
        });
    } catch (e) {
        sendErrorLog(e);
        res.status(500).json({ status: res.statusCode });
        return;
    }
    if (!isValid) {
        res.status(401).json({ status: res.statusCode });
        return;
    }

    let message = req.body?.content;
    let time = req.body?.time;

    if (!!!message || !!!time) {
        res.status(400).json({ status: res.statusCode });
        return;
    }

    sendHook({
        time,
        message,
    });

    res.json({
        status: res.statusCode,
    });
});

module.exports = router;
