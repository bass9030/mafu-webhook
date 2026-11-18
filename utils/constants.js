// 여러 모듈에서 함께 쓰는 고정 값
// Discord 메시지, X 요청, LINE 중계 인증에 그대로 쓰이므로 값을 바꾸면 외부 동작이 바뀜

/** 마후마후 X 계정 ID (username이 아님) */
const MAFU_USER_ID = 268758461;
/** 마후마후 X username */
const MAFU_SCREEN_NAME = "uni_mafumafu";

const LOGO_URL = "https://mahook.bass9030.dev/logo.png";
/** Discord 웹후크 메시지에 표시되는 이름 */
const BOT_USERNAME = "마훅 - 마후 트윗 번역봇";
/** 트윗/공지 embed footer 문구 */
const FOOTER_TEXT = "마훅 - 한글 번역된 마후마후 트윗을 디스코드에서";

/** embed 색상 (TWITTER는 구독 완료 embed에도 사용) */
const EMBED_COLOR = Object.freeze({
    TWITTER: 0x1da1f2,
    NOTICE: 4037805,
    LINE: 0x06c755,
});

const LINE_URL = "https://line.me/R/ti/p/@uni_mafumafu";
const LINE_ICON_URL =
    "https://profile.line-scdn.net/0hwr6BH-fyKF0LOwNQZWNXCjd-JjB8FS4Vc14yOixocmokW21eMVo3b34-cTp2X2sOMgpmM35ocGVy/preview";
/** LINE 중계 서버가 보내는 user-agent */
const LINE_RELAY_USER_AGENT = "mahook-line/3.0";

module.exports = {
    MAFU_USER_ID,
    MAFU_SCREEN_NAME,
    LOGO_URL,
    BOT_USERNAME,
    FOOTER_TEXT,
    EMBED_COLOR,
    LINE_URL,
    LINE_ICON_URL,
    LINE_RELAY_USER_AGENT,
};
