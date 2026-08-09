import { EmbedBuilder } from "discord.js";
import type { LineMessage } from "../types/domain";
import translateText from "./translator";
import { WebhookManager, WebhookType } from "./webhookManager";

export async function sendHook(data: LineMessage): Promise<void> {
    const translatedText = await translateText(data.message);
    const originalLink = "https://line.me/R/ti/p/@uni_mafumafu";
    const embed = new EmbedBuilder()
        .setTitle("New LINE Release!")
        .setURL(originalLink)
        .setFooter({
            text: originalLink,
            iconURL:
                "https://profile.line-scdn.net/0hwr6BH-fyKF0LOwNQZWNXCjd-JjB8FS4Vc14yOixocmokW21eMVo3b34-cTp2X2sOMgpmM35ocGVy/preview",
        })
        .setTimestamp(new Date(Number(data.time)))
        .setDescription(translatedText.trim())
        .setColor(0x06c755);

    const manager = new WebhookManager();
    await manager.getConnection();
    try {
        await manager.sendWebhook(embed, WebhookType.LINE);
    } finally {
        await manager.releaseConnection();
    }
}
