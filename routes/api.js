var express = require("express");
var router = express.Router();
const crypto = require("crypto");
const {
    webhookManager,
    WebhookNotFoundError,
} = require("../utils/webhookManager");
var createError = require("http-errors");
const { getProfileURL, sendRecentTweet } = require("../utils/getTweet_new");
const { Webhook, MessageBuilder } = require("discord-webhook-node");

router.post("/register", async function (req, res, next) {
    let data = req.body;
    if (!!!req.body && !!!req.body.url) {
        res.status(400).json({ status: -99 });
        return;
    }

    try {
        if (
            data.roleID != "@everyone" &&
            data.roleID != "@here" &&
            !!!String(data.roleID).match(/[0-9]+/g) &&
            data.roleID != -1
        ) {
            res.status(400);
            res.json({
                status: -2,
                message:
                    "역할 ID가 올바르지 않습니다.\n역할 ID는 @everyone, @here 또는 숫자로된 역할 ID여야 합니다.",
            });
            return;
        }

        let embed = new MessageBuilder()
            .setTitle("마훅 구독 완료!")
            .setDescription(
                "마훅 구독이 완료되었습니다!\n이제부터 마후마후 트윗을 한국어로 즐겨보세요!"
            )
            .setColor("#1da1f2");
        let hook = new Webhook(data.url);
        hook.setUsername("마훅 - 마후 트윗 번역봇");
        hook.setAvatar(await getProfileURL());
        await hook.send(embed);

        await webhookManager.addWebhook(data.url, data.roleID, data.sendNoti);

        res.json({ status: 0 });
    } catch (e) {
        console.error(e);
        if (e.errno == 1062) {
            res.status(409);
            res.json({ status: -2, message: "이미 등록된 웹후크 URL 입니다." });
        } else if (e.message.includes("Error sending webhook")) {
            res.status(400);
            res.json({
                status: -2,
                message: "올바르지 않은 웹후크 URL 입니다.",
            });
        } else {
            res.status(500);
            res.json({ status: -1 });
        }
    }
});

router.post("/edit", async (req, res, next) => {
    let data = req.body;
    if (!!!req.body && !!!req.body.url) {
        res.status(400).json({ status: -99 });
        return;
    }

    if (
        data.roleID != "@everyone" &&
        data.roleID != "@here" &&
        data.roleID != "-1" &&
        !!!String(data.roleID).match(/[0-9]+/g)
    ) {
        res.status(400);
        res.json({
            status: -2,
            message:
                "역할 ID가 올바르지 않습니다.\n역할 ID는 @everyone, @here 또는 숫자로된 역할 ID여야 합니다.",
        });
        return;
    }

    try {
        await webhookManager.editWebhook(data.url, data.roleID, data.sendNoti);
        res.json({ status: 0 });
    } catch (e) {
        if (e instanceof WebhookNotFoundError) {
            res.status(404);
            res.json({
                status: -2,
                message:
                    "웹후크를 찾을 수 없습니다. 등록된 웹후크인지 확인해주세요.",
            });
        } else {
            res.status(500);
            res.json({ status: -1 });
        }
    }
});

router.delete("/unregister", async (req, res, next) => {
    let data = req.query;
    if (!!!req.query?.url) {
        res.status(400).json({ status: -99 });
        return;
    }
    try {
        await webhookManager.removeWebhook(decodeURIComponent(data.url));
        res.json({ status: 0 });
    } catch (e) {
        if (e instanceof WebhookNotFoundError) {
            res.status(404);
            res.json({
                status: -2,
                message:
                    "웹후크를 찾을 수 없습니다. 등록된 웹후크인지 확인해주세요.",
            });
        } else {
            res.status(500);
            res.json({ status: -1 });
        }
    }
});

router.get("/getNotices", async (req, res, next) => {
    try {
        let data = await webhookManager.getNotices();
        res.json({ status: 0, data });
    } catch (e) {
        res.status(500);
        res.json({ status: -1 });
    }
});

router.post("/sendNoti", (req, res, next) => {
    try {
        const hashedHeader = crypto
            .createHash("sha512")
            .update(req.body["amazing-something"])
            .digest("hex");
        if (hashedHeader == process.env.NOTICE_TOKEN_KEY.toLowerCase()) {
            if (!!!req.body.content || !!!req.body.title) {
                res.status(400).json({ status: -1 });
                return;
            }

            webhookManager.sendNotice(req.body.title, req.body.content);
            res.send("공지 전송 성공!");
        } else {
            res.status(403).json({ status: -99 });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ status: -1 });
    }
});

router.get("/testWebhook", (req, res, next) => {
    if (req.app.get("env") !== "development") {
        next(createError(404));
        return;
    }
    sendRecentTweet(req.query.id);
    res.send("웹훅 전송 성공");
});

module.exports = router;
