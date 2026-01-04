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

const webhookManager = new WebhookManager();

router.post("/register", async function (req, res, next) {
    if (!!!req.body && !!!req.body.url) {
        res.status(400).json({ status: res.statusCode });
        return;
    }

    let data = req.body;

    try {
        // role id check
        if (
            data.roleID != "@everyone" &&
            data.roleID != "@here" &&
            !!!String(data.roleID).match(/[0-9]+/g) &&
            data.roleID != -1
        ) {
            res.status(400);
            res.json({
                status: res.statusCode,
                message:
                    "역할 ID가 올바르지 않습니다.\n역할 ID는 @everyone, @here 또는 숫자로된 역할 ID여야 합니다.",
            });
            return;
        }

        // webhook url check
        if (
            !!!data.url.match(
                /discord(app)?\.com\/api\/webhooks\/[0-9]+\/[A-z0-9_\.\-]+/g
            )
        ) {
            res.status(400);
            res.json({
                status: res.statusCode,
                message: "올바르지 않은 웹후크 URL 입니다.",
            });
            return;
        }

        data.url = data.url.split("//")[1];
        let channelID = data.url.split("/")[3];
        let webhookToken = data.url.split("/")[4];

        let embed = new EmbedBuilder();
        embed.setTitle("마훅 구독 완료!");
        embed.setDescription(
            "마훅 구독이 완료되었습니다!\n이제부터 마후마후 트윗을 한국어로 즐겨보세요!"
        );
        embed.setColor(0x1da1f2);

        let hook = new WebhookClient({
            id: channelID,
            token: webhookToken,
        });

        await hook.send({
            content: "",
            username: "마훅 - 마후 트윗 번역봇",
            avatarURL: await getProfileURL(),
            embeds: [embed],
        });

        await webhookManager.getConnection();
        await webhookManager.addWebhook(
            channelID,
            webhookToken,
            data.options,
            data.roleID
        );
        res.json({ status: res.statusCode });
        webhookManager.releaseConnection();
    } catch (e) {
        console.error(e);
        if (e.errno == 1062) {
            res.status(409);
            res.json({
                status: res.statusCode,
                message: "이미 등록된 웹후크 URL 입니다.",
            });
        } else if (e.code == 10015 || e.status == 404) {
            res.status(400);
            res.json({
                status: res.statusCode,
                message: "올바르지 않은 웹후크 URL 입니다.",
            });
        } else {
            res.status(500);
            res.json({ status: res.statusCode });
        }
    }
});

router.post("/edit", async (req, res, next) => {
    let data = req.body;
    if (!!!req.body && !!!req.body.url) {
        res.status(400).json({ status: res.statusCode });
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
            status: res.statusCode,
            message:
                "역할 ID가 올바르지 않습니다.\n역할 ID는 @everyone, @here 또는 숫자로된 역할 ID여야 합니다.",
        });
        return;
    }

    try {
        data.url = data.url.split("//")[1];
        let channelID = data.url.split("/")[3];
        let webhookToken = data.url.split("/")[4];

        await webhookManager.getConnection();
        await webhookManager.editWebhook(
            channelID,
            webhookToken,
            data.roleID,
            data.sendNoti
        );
        res.json({ status: res.statusCode });
        webhookManager.releaseConnection();
    } catch (e) {
        if (e instanceof WebhookNotFoundError) {
            res.status(404);
            res.json({
                status: res.statusCode,
                message:
                    "웹후크를 찾을 수 없습니다. 올바른 웹후크 URL인지 확인해주세요.",
            });
        } else {
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
    data.url = data.url.split("//")[1];
    let channelID = data.url.split("/")[3];
    let webhookToken = data.url.split("/")[4];
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
                message:
                    "웹후크를 찾을 수 없습니다. 등록된 웹후크인지 확인해주세요.",
            });
        } else {
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
        res.status(500);
        res.json({ status: res.statusCode });
    }
});

router.post("/sendNoti", async (req, res, next) => {
    try {
        const hashedHeader = crypto
            .createHash("sha512")
            .update(req.body["amazing-something"])
            .digest("hex");
        if (hashedHeader == process.env.NOTICE_TOKEN_KEY.toLowerCase()) {
            if (!!!req.body.content || !!!req.body.title) {
                res.status(400).json({ status: res.statusCode });
                return;
            }
            await webhookManager.getConnection();
            await webhookManager.sendNotice(req.body.title, req.body.content);
            res.send("공지 전송 성공!");
            webhookManager.releaseConnection();
        } else {
            res.status(403).json({ status: res.statusCode });
        }
    } catch (e) {
        console.error(e);
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
        res.send("웹훅 전송 성공");
    } catch (e) {
        console.error(e);
        res.status(500).send(`<pre><code>${e.stack}</code></pre>`);
    }
});

router.post("/line-webhook", async (req, res, next) => {
    if (req.headers["user-agent"] == "mahook-line/3.0") {
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

        let message = req.body.content;
        let time = req.body.time;
        let profileImg = req.body.profileImg;

        if (!!!message || !!!time) {
            res.status(400).json({ status: res.statusCode });
            return;
        }

        sendHook({
            time,
            message,
            profileImg,
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
