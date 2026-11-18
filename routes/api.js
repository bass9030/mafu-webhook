var express = require("express");
var router = express.Router();
const crypto = require("crypto");
const {
    WebhookManager,
    WebhookNotFoundError,
} = require("../utils/webhookManager");
var createError = require("http-errors");
const { getProfileURL, sendRecentTweet } = require("../utils/getTweet");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const getOTP = require("../utils/otpGenerator");
const { sendHook } = require("../utils/sendLINE");
const { sendErrorLog } = require("../utils/DebugLogger");
const {
    BOT_USERNAME,
    EMBED_COLOR,
    LINE_RELAY_USER_AGENT,
} = require("../utils/constants");
const {
    parseWebhookUrl,
    isValidWebhookUrl,
    isValidRoleID,
} = require("../utils/webhookInput");
const MESSAGES = require("./messages");

const webhookManager = new WebhookManager();

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

        let embed = new EmbedBuilder();
        embed.setTitle("마훅 구독 완료!");
        embed.setDescription(
            "마훅 구독이 완료되었습니다!\n이제부터 마후마후 트윗을 한국어로 즐겨보세요!",
        );
        embed.setColor(EMBED_COLOR.TWITTER);

        let hook = new WebhookClient({
            id: channelID,
            token: webhookToken,
        });

        await hook.send({
            content: "",
            username: BOT_USERNAME,
            avatarURL: await getProfileURL(),
            embeds: [embed],
        });

        await webhookManager.getConnection();
        await webhookManager.addWebhook(
            channelID,
            webhookToken,
            data.options,
            data.roleID,
        );
        res.json({ status: res.statusCode });
        webhookManager.releaseConnection();
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

        await webhookManager.getConnection();
        await webhookManager.editWebhook(
            channelID,
            webhookToken,
            data.options,
            data.roleID,
        );
        res.json({ status: res.statusCode });
        webhookManager.releaseConnection();
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
        await webhookManager.getConnection();
        await webhookManager.removeWebhook(channelID, webhookToken);
        res.json({ status: res.statusCode });
        await webhookManager.releaseConnection();
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
        await webhookManager.getConnection();
        let data = await webhookManager.getNotices();
        res.json({ status: res.statusCode, data });
        webhookManager.releaseConnection();
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
            await webhookManager.getConnection();
            await webhookManager.sendNotice(req.body?.title, req.body?.content);
            res.send(MESSAGES.NOTICE_SENT);
            webhookManager.releaseConnection();
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

router.post("/line-webhook", async (req, res, next) => {
    if (req.headers["user-agent"] == LINE_RELAY_USER_AGENT) {
        let otps = getOTP();
        let req_otp = req.headers["authorization"];
        // console.log(req.body);
        // console.log(req_otp, otps.now);
        if (
            !(
                otps.future == req_otp ||
                otps.now == req_otp ||
                otps.past == req_otp
            )
        ) {
            res.status(403);
            res.json({ status: res.statusCode });
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
    } else {
        next(createError(404));
        return;
    }
});

module.exports = router;
