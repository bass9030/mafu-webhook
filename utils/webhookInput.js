// 구독 API(/api/register, /api/edit, /api/unregister) 입력 파싱/검증

/**
 * Discord 웹후크 URL에서 채널 ID와 토큰 추출
 * url이 문자열이 아니거나 "//"가 없으면 TypeError를 던짐 (호출부의 오류 처리가 이에 의존)
 * @param {string} url 예: https://discord.com/api/webhooks/{channelID}/{webhookToken}
 * @returns {{ channelID: string, webhookToken: string }}
 */
function parseWebhookUrl(url) {
    const path = url.split("//")[1];
    const channelID = path.split("/")[3];
    const webhookToken = path.split("/")[4];
    return { channelID, webhookToken };
}

/**
 * Discord 웹후크 URL 형식 검사
 * url이 문자열이 아니면 TypeError를 던짐
 * @param {string} url
 */
function isValidWebhookUrl(url) {
    return !!url.match(
        /discord(app)?\.com\/api\/webhooks\/[0-9]+\/[A-z0-9_\.\-]+/g,
    );
}

/**
 * 멘션 역할 ID 검사: @everyone, @here, 숫자가 포함된 값(역할 ID, 멘션 안 함 = -1)
 * @param {any} roleID
 */
function isValidRoleID(roleID) {
    return (
        roleID == "@everyone" ||
        roleID == "@here" ||
        !!String(roleID).match(/[0-9]+/g)
    );
}

module.exports = {
    parseWebhookUrl,
    isValidWebhookUrl,
    isValidRoleID,
};
