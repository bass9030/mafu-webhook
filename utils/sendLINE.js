const { EmbedBuilder } = require("discord.js");
const { WebhookManager, WEBHOOK_TYPE } = require("./webhookManager");
const translateText = require("./translator");

async function sendHook(data) {
    let translatedText = await translateText(data.message);

    let originalLink = "https://line.me/R/ti/p/@uni_mafumafu";

    // embed 메시지 생성
    let embed = new EmbedBuilder();
    embed.setTitle("New LINE Release!");
    embed.setURL(originalLink);
    embed.setFooter({
        text: originalLink,
        iconURL:
            "https://profile.line-scdn.net/0hwr6BH-fyKF0LOwNQZWNXCjd-JjB8FS4Vc14yOixocmokW21eMVo3b34-cTp2X2sOMgpmM35ocGVy/preview",
    });
    embed.setTimestamp(new Date(parseInt(data.time)));
    embed.setDescription(translatedText.trim());
    embed.setColor(0x06c755);

    const webhookManager = new WebhookManager();
    await webhookManager.getConnection();
    await webhookManager.sendWebhook(embed, WEBHOOK_TYPE.LINE);
    webhookManager.releaseConnection();
}

module.exports = {
    sendHook,
};
