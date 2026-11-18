// DEEPL_API_KEY가 없을 때 (Translator 캐시가 비어 있는 새 프로세스가 필요해서 파일 분리)
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { installStubs, reset, state } = require("./helpers/stub");

installStubs();
process.env.DEEPL_API_KEY = "";
const translateText = require("../utils/translator");

beforeEach(() => {
    reset();
    state.geminiHandler = () => {
        throw new Error("gemini down");
    };
    state.deeplHandler = () => ({ text: "딥엘" });
});

test("키가 없으면 DeepL 폴백도 실패해 null (매 호출마다 생성 재시도)", async () => {
    for (let i = 0; i < 2; i++) {
        reset();
        state.geminiHandler = () => {
            throw new Error("gemini down");
        };
        assert.equal(await translateText("原文"), null);
        assert.deepEqual(
            state.captured.map((e) => e.message),
            ["gemini down", "authKey must be a non-empty string"],
        );
    }
    assert.deepEqual(state.deeplKeys, []);
});

test("키가 설정되면 그 다음 호출부터 DeepL 사용", async () => {
    process.env.DEEPL_API_KEY = "late-key";
    assert.equal(await translateText("原文"), "딥엘");
    assert.deepEqual(state.deeplKeys, ["late-key"]);
});
