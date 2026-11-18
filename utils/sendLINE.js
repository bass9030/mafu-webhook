const { EmbedBuilder } = require("discord.js");
const { WebhookManager, WEBHOOK_TYPE } = require("./webhookManager");
const translateText = require("./translator");
const { EMBED_COLOR, LINE_URL, LINE_ICON_URL } = require("./constants");

async function sendHook(data) {
    let translatedText = await translateText(data.message);

    let originalLink = LINE_URL;

    // embed 메시지 생성
    let embed = new EmbedBuilder();
    embed.setTitle("New LINE Release!");
    embed.setURL(originalLink);
    embed.setFooter({
        text: originalLink,
        iconURL: LINE_ICON_URL,
    });
    embed.setTimestamp(new Date(parseInt(data.time)));
    embed.setDescription(translatedText.trim());
    embed.setColor(EMBED_COLOR.LINE);

    await WebhookManager.withConnection(async (webhookManager) => {
        await webhookManager.sendWebhook(embed, WEBHOOK_TYPE.LINE);
    });
}

module.exports = {
    sendHook,
};
