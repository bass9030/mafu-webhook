// 트윗 → Discord embed
const { EmbedBuilder } = require("discord.js");
const { generateTweetMarkdown } = require("./markdown");
const { setProfileURL } = require("./profile");
const {
    MAFU_SCREEN_NAME,
    LOGO_URL,
    FOOTER_TEXT,
    EMBED_COLOR,
} = require("../constants");

/**
 * tweetInfo 데이터를 기반으로 Discord 훅 전송
 * @param {object} tweetInfo 트윗 정보 Object
 * @returns {Promise<EmbedBuilder[]>} Discord EmbedBuilder 배열
 */
async function getWebhookEmbed(tweetInfo) {
    let created_at = new Date(tweetInfo.legacy?.created_at);

    // 번역
    let translatedText = await generateTweetMarkdown(tweetInfo);
    // console.log(translatedText);
    // translatedText = await translateText(translatedText);

    //프로필 URL
    let profileURL = tweetInfo.core.user_results.result.avatar.image_url;
    setProfileURL(profileURL);
    let originalLink =
        `https://x.com/${MAFU_SCREEN_NAME}/status/` + tweetInfo.legacy.id_str;

    const embeds = [];

    // embed 메시지 생성
    let embed = new EmbedBuilder();

    // console.log(JSON.stringify(tweetInfo, null, 2));

    embed.setTitle("New Tweet Release!");
    embed.setURL(originalLink);
    embed.setAuthor({
        name: `${tweetInfo.core.user_results.result.core.name} (@${tweetInfo.core.user_results.result.core.screen_name})`,
        iconURL: profileURL,
        url: `https://x.com/${MAFU_SCREEN_NAME}`,
    });
    embed.setFooter({
        text: FOOTER_TEXT,
        iconURL: LOGO_URL,
    });
    embed.setTimestamp(created_at);
    embed.setDescription(translatedText);
    embed.setColor(EMBED_COLOR.TWITTER);

    let medias = null;

    if (!!tweetInfo.legacy.entities.media?.length) {
        // 미디어 처리(일반)
        medias = tweetInfo.legacy.entities.media;
    } else if (
        !!tweetInfo.legacy.retweeted_status_result?.result?.legacy?.entities
            ?.media?.length
    ) {
        // 미디어 처리(RT)
        medias =
            tweetInfo.legacy.retweeted_status_result?.result?.legacy?.entities
                ?.media;
    } else if (
        !!tweetInfo?.quoted_status_result &&
        !!tweetInfo.quoted_status_result.result?.legacy?.entities?.media?.length
    ) {
        // 미디어 처리(인용)
        medias = tweetInfo.quoted_status_result.result.legacy.entities.media;
    }

    if (!!medias) {
        let imgCnt = medias.length;
        if (imgCnt > 4) imgCnt = 4;
        for (let i = 0; i < imgCnt; i++) {
            const media = medias[i];
            if (["photo", "video"].includes(media.type)) {
                if (i == 0) embed.setImage(media.media_url_https);
                else {
                    let imageEmbed = new EmbedBuilder();
                    imageEmbed.setURL(originalLink);
                    imageEmbed.setImage(media.media_url_https);
                    embeds.push(imageEmbed);
                }
            }
        }
    }

    return [embed, ...embeds];
}

module.exports = {
    getWebhookEmbed,
};
