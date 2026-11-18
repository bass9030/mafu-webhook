// API 응답 메시지 (프런트(public/script.js)에 그대로 표시되므로 문구를 바꾸면 외부 동작이 바뀜)

module.exports = Object.freeze({
    INVALID_ROLE_ID:
        "역할 ID가 올바르지 않습니다.\n역할 ID는 @everyone, @here 또는 숫자로된 역할 ID여야 합니다.",
    INVALID_WEBHOOK_URL: "올바르지 않은 웹후크 URL 입니다.",
    DUPLICATED_WEBHOOK: "이미 등록된 웹후크 URL 입니다.",
    EDIT_WEBHOOK_NOT_FOUND:
        "웹후크를 찾을 수 없습니다. 올바른 웹후크 URL인지 확인해주세요.",
    UNREGISTER_WEBHOOK_NOT_FOUND:
        "웹후크를 찾을 수 없습니다. 등록된 웹후크인지 확인해주세요.",
    NOTICE_SENT: "공지 전송 성공!",
    TEST_WEBHOOK_SENT: "웹훅 전송 성공",
});
