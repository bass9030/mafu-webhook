// Discord 웹후크 메시지 구성
const { WebhookClient, EmbedBuilder } = require("discord.js");
const {
    LOGO_URL,
    BOT_USERNAME,
    FOOTER_TEXT,
    EMBED_COLOR,
    WEBHOOK_TYPE,
} = require("./constants");

/**
 * @param {string} channelID
 * @param {string} webhookToken
 */
function createWebhookClient(channelID, webhookToken) {
    return new WebhookClient({
        id: channelID,
        token: webhookToken,
    });
}

/**
 * 멘션 문자열 (멘션 옵션이 켜진 웹후크에만 사용)
 * @param {string|number} roleID "@everyone", "@here", 역할 ID, -1(멘션 안 함)
 */
function buildMention(roleID) {
    if (roleID != -1) {
        if (roleID == "@everyone" || roleID == "@here") return roleID;
        else return "<@&" + roleID + ">";
    }
    return "";
}

/** 구독 완료 embed */
function buildWelcomeEmbed() {
    let embed = new EmbedBuilder();
    embed.setTitle("마훅 구독 완료!");
    embed.setDescription(
        "마훅 구독이 완료되었습니다!\n이제부터 마후마후 트윗을 한국어로 즐겨보세요!",
    );
    embed.setColor(EMBED_COLOR.TWITTER);
    return embed;
}

/** 공지 embed */
function buildNoticeEmbed(title, content) {
    const embed = new EmbedBuilder();
    embed.setTitle("마훅 공지사항");
    embed.setFields({
        name: title,
        value: content,
    });
    embed.setColor(EMBED_COLOR.NOTICE);
    embed.setFooter({
        text: FOOTER_TEXT,
        iconURL: LOGO_URL,
    });
    return embed;
}

/**
 * WebhookManager.sendWebhook이 수신자마다 보내는 페이로드
 * - NOTI: message = { title, content }
 * - TWITTER, LINE: message = EmbedBuilder[] (첫 embed의 footer 아이콘을 avatar로 사용)
 *   LINE에 EmbedBuilder 하나만 넘기면 message[0]에서 TypeError (기존 동작)
 * @param {EmbedBuilder[] | {title: string, content: string}} message
 * @param {number} type WEBHOOK_TYPE
 * @param {string} mention
 * @returns {object | null} 알 수 없는 type이면 null (전송하지 않음)
 */
function buildWebhookPayload(message, type, mention) {
    let profileURL;
    switch (type) {
        case WEBHOOK_TYPE.NOTI:
            profileURL = LOGO_URL;
            return {
                avatarURL: profileURL,
                username: BOT_USERNAME,
                content: mention,
                embeds: [buildNoticeEmbed(message.title, message.content)],
            };
        case WEBHOOK_TYPE.TWITTER:
        case WEBHOOK_TYPE.LINE:
            profileURL = message[0].data["author"]["icon_url"];
            return {
                avatarURL: profileURL,
                username: BOT_USERNAME,
                content: mention,
                embeds: message,
            };
    }
    return null;
}

module.exports = {
    createWebhookClient,
    buildMention,
    buildWelcomeEmbed,
    buildNoticeEmbed,
    buildWebhookPayload,
};
