// 마후마후 프로필 이미지 URL 캐시 (구독 완료 메시지의 avatar로 사용)
const { getTimelineByUserID } = require("./client");
const { MAFU_USER_ID, LOGO_URL } = require("../constants");

/** 마지막으로 embed를 만든 트윗 작성자의 프로필 이미지 (getWebhookEmbed가 갱신) */
let profileURL = "";

function setProfileURL(url) {
    profileURL = url;
}

async function getProfileURL() {
    if (!!profileURL) {
        return profileURL;
    } else {
        try {
            let tweetInfo = await getTimelineByUserID(MAFU_USER_ID, 1);
            // 주의: 결과를 profileURL에 저장하지 않아 빈 문자열이 반환됨 (기존 동작)
            tweetInfo[0].core.user_results.result.avatar.image_url;
            return profileURL;
        } catch {
            return LOGO_URL;
        }
    }
}

module.exports = {
    setProfileURL,
    getProfileURL,
};
