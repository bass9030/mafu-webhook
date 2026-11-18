const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
    parseWebhookUrl,
    isValidWebhookUrl,
    isValidRoleID,
} = require("../utils/webhookInput");

// 리팩터링 전 routes/api.js의 roleID 검사식 (true = 잘못된 값)
const legacyRegisterInvalid = (roleID) =>
    roleID != "@everyone" &&
    roleID != "@here" &&
    !!!String(roleID).match(/[0-9]+/g) &&
    roleID != -1;
const legacyEditInvalid = (roleID) =>
    roleID != "@everyone" &&
    roleID != "@here" &&
    roleID != "-1" &&
    !!!String(roleID).match(/[0-9]+/g);

// JSON/폼으로 들어올 수 있는 값 위주
const ROLE_ID_CORPUS = [
    "@everyone", "@here", "@Everyone", " @everyone", "@everyone ",
    "123", "0", "-1", -1, 1, 0, -0, 1.5, "1e3", "abc1", "１２３",
    "", " ", "abc", "-", "@", "everyone", "NaN", "Infinity", "-Infinity",
    NaN, Infinity, -Infinity,
    true, false, null, undefined,
    [], [-1], ["-1"], ["@everyone"], ["@here"], ["abc"], [1, 2], [[]], [null],
    {}, { a: 1 }, { toString: null },
];

test("isValidRoleID는 기존 /register, /edit 검사식과 모든 입력에서 같은 결과", () => {
    for (const v of ROLE_ID_CORPUS) {
        let expected;
        try {
            expected = !legacyRegisterInvalid(v);
        } catch (e) {
            // 두 식 모두 같은 값에서 같은 방식으로 실패해야 함
            assert.throws(() => legacyEditInvalid(v));
            assert.throws(() => isValidRoleID(v));
            continue;
        }
        assert.equal(!legacyEditInvalid(v), expected, `edit: ${String(v)}`);
        assert.equal(isValidRoleID(v), expected, `new: ${String(v)}`);
    }
});

test("isValidRoleID 예시", () => {
    for (const v of ["@everyone", "@here", "123", -1, "-1", "abc1"]) {
        assert.equal(isValidRoleID(v), true, String(v));
    }
    for (const v of ["abc", "", null, undefined, "@Everyone"]) {
        assert.equal(isValidRoleID(v), false, String(v));
    }
});

test("isValidWebhookUrl", () => {
    assert.equal(isValidWebhookUrl("https://discord.com/api/webhooks/1/abc_-.X"), true);
    assert.equal(isValidWebhookUrl("https://discordapp.com/api/webhooks/1/a"), true);
    assert.equal(isValidWebhookUrl("discord.com/api/webhooks/1/a"), true);
    // [A-z]는 [ \ ] ^ _ ` 도 포함 (현재 동작)
    assert.equal(isValidWebhookUrl("https://discord.com/api/webhooks/1/^"), true);
    assert.equal(isValidWebhookUrl("https://discord.com/api/webhooks/a/b"), false);
    assert.equal(isValidWebhookUrl("https://discord.com/api/webhooks/1/"), false);
    assert.equal(isValidWebhookUrl("https://example.com/api/webhooks/1/a"), false);
    // 같은 정규식을 반복 사용해도 결과가 같음 (g 플래그 상태 문제 없음)
    for (let i = 0; i < 3; i++) {
        assert.equal(isValidWebhookUrl("https://discord.com/api/webhooks/1/a"), true);
    }
    assert.throws(() => isValidWebhookUrl(undefined), TypeError);
    assert.throws(() => isValidWebhookUrl(123), TypeError);
});

// 리팩터링 전 split 로직
function legacyParse(url) {
    url = url.split("//")[1];
    return { channelID: url.split("/")[3], webhookToken: url.split("/")[4] };
}

test("parseWebhookUrl은 기존 split 로직과 같은 결과/예외", () => {
    const cases = [
        "https://discord.com/api/webhooks/123/tok",
        "https://discordapp.com/api/webhooks/123/tok/extra",
        "https://discord.com/api/webhooks/123/tok?wait=true",
        "https://discord.com/api/webhooks/123",
        "http://a//b/c/d/e/f",
        "https://",
        "abc",
        "",
        undefined,
        null,
        123,
        ["https://discord.com/api/webhooks/1/t"],
    ];
    for (const url of cases) {
        let expected;
        try {
            expected = legacyParse(url);
        } catch (e) {
            assert.throws(() => parseWebhookUrl(url), e.constructor, String(url));
            continue;
        }
        assert.deepEqual(parseWebhookUrl(url), expected, String(url));
    }
    assert.deepEqual(parseWebhookUrl("https://discord.com/api/webhooks/123/tok"), {
        channelID: "123",
        webhookToken: "tok",
    });
});
