// LINE 게시물 → embed 생성 (utils/sendLINE.js)
// sendWebhook에 넘기는 인자를 검사한다. 실제 전송 결과는 api.test.js의 /api/line-webhook 테스트에서 확인.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { installStubs, reset, state } = require("./helpers/stub");

let translateImpl;
installStubs({ translator: async (t) => translateImpl(t) });
const { WebhookManager, WEBHOOK_TYPE } = require("../utils/webhookManager");
const { sendHook } = require("../utils/sendLINE");

const calls = [];
WebhookManager.prototype.sendWebhook = async function (message, type) {
    calls.push({ message, type, connected: !!this.db });
};

beforeEach(() => {
    reset();
    calls.length = 0;
    translateImpl = async (t) => `  [KO]${t}\n`;
});

test("번역한 본문으로 LINE embed를 만들어 LINE 타입으로 전송, 커넥션 반환", async () => {
    await sendHook({ message: "こんにちは", time: "1700000000000" });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, WEBHOOK_TYPE.LINE);
    assert.equal(calls[0].connected, true);
    // sendWebhook은 embed 배열을 받음
    assert.ok(Array.isArray(calls[0].message));
    assert.equal(calls[0].message.length, 1);
    assert.deepEqual(calls[0].message[0].toJSON(), {
        title: "New LINE Release!",
        url: "https://line.me/R/ti/p/@uni_mafumafu",
        footer: {
            text: "https://line.me/R/ti/p/@uni_mafumafu",
            icon_url:
                "https://profile.line-scdn.net/0hwr6BH-fyKF0LOwNQZWNXCjd-JjB8FS4Vc14yOixocmokW21eMVo3b34-cTp2X2sOMgpmM35ocGVy/preview",
        },
        timestamp: "2023-11-14T22:13:20.000Z",
        description: "[KO]こんにちは",
        color: 0x06c755,
    });
    assert.equal(state.acquired, 1);
    assert.equal(state.released, 1);
});

test("[현재 동작] 번역 결과가 null이면 TypeError, 전송하지 않음", async () => {
    translateImpl = async () => null;
    await assert.rejects(sendHook({ message: "x", time: "1" }), TypeError);
    assert.equal(calls.length, 0);
    assert.equal(state.acquired, 0);
});

test("전송 중 오류가 나도 커넥션을 반환하고 오류는 전파", async () => {
    const err = new Error("query failed");
    const original = WebhookManager.prototype.sendWebhook;
    WebhookManager.prototype.sendWebhook = async () => {
        throw err;
    };
    try {
        await assert.rejects(sendHook({ message: "x", time: "1" }), err);
    } finally {
        WebhookManager.prototype.sendWebhook = original;
    }
    assert.equal(state.acquired, 1);
    assert.equal(state.released, 1);
});
