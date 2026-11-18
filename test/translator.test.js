const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { installStubs, reset, state } = require("./helpers/stub");

installStubs();
const translateText = require("../utils/translator");
const glossary = require("../data/glossary.json");

beforeEach(() => reset());

test("모듈 로드 시 GEMINI_API_KEY로 GoogleGenAI 생성", () => {
    assert.deepEqual(state.genAIOptions, { apiKey: "test-gemini-key" });
});

test("빈 문자열은 API 호출 없이 빈 문자열", async () => {
    assert.equal(await translateText(""), "");
    assert.equal(state.geminiCalls.length, 0);
    assert.equal(state.deeplCalls.length, 0);
});

test("Gemini 성공: 결과 반환, 프롬프트에 용어집과 원문 치환", async () => {
    state.geminiHandler = () => ({ text: "번역문" });
    assert.equal(await translateText("原文です"), "번역문");
    assert.equal(state.deeplCalls.length, 0);

    assert.equal(state.geminiCalls.length, 1);
    const req = state.geminiCalls[0];
    assert.equal(req.model, "gemini-3.5-flash-lite");
    assert.ok(!req.contents.includes("{{GLOSSARY}}"));
    assert.ok(!req.contents.includes("{{TEXT}}"));
    assert.ok(req.contents.includes("<text>\n原文です\n</text>"));
    assert.ok(req.contents.includes(`${glossary[0].ja} → ${glossary[0].ko}`));
    assert.ok(
        req.contents.includes(
            glossary.map((i) => `${i.ja} → ${i.ko}`).join("\n"),
        ),
    );
    assert.deepEqual(
        req.config.safetySettings.map((s) => [s.category, s.threshold]),
        [
            ["HARM_CATEGORY_DANGEROUS_CONTENT", "BLOCK_NONE"],
            ["HARM_CATEGORY_HARASSMENT", "BLOCK_NONE"],
            ["HARM_CATEGORY_HATE_SPEECH", "BLOCK_NONE"],
            ["HARM_CATEGORY_SEXUALLY_EXPLICIT", "BLOCK_NONE"],
        ],
    );
});

test("Gemini 결과의 백슬래시 하나는 백슬래시 셋으로 치환", async () => {
    state.geminiHandler = () => ({ text: "a\\b\\\\c" });
    assert.equal(await translateText("x"), "a\\\\\\b\\\\\\\\\\\\c");
});

test("[현재 동작] 원문에 $& 가 있으면 String.replace 특수 패턴으로 해석됨", async () => {
    state.geminiHandler = () => ({ text: "" });
    await translateText("A$&B");
    assert.ok(state.geminiCalls[0].contents.includes("<text>\nA{{TEXT}}B\n</text>"));
});

test("Gemini 실패 시 DeepL(ja→ko, glossary)로 폴백", async () => {
    const err = new Error("gemini down");
    state.geminiHandler = () => {
        throw err;
    };
    state.deeplHandler = () => ({ text: "딥엘 번역" });

    assert.equal(await translateText("原文"), "딥엘 번역");
    assert.deepEqual(state.captured, [err]);
    assert.deepEqual(state.deeplKeys.at(-1), "test-deepl-key");
    assert.deepEqual(state.deeplCalls, [
        ["原文", "ja", "ko", { glossary: "test-glossary-id" }],
    ]);
});

test("DeepL은 호출마다 Translator를 새로 생성", async () => {
    state.geminiHandler = () => {
        throw new Error("x");
    };
    const before = state.deeplKeys.length;
    await translateText("a");
    await translateText("b");
    assert.equal(state.deeplKeys.length - before, 2);
});

test("[현재 동작] Gemini, DeepL 모두 실패하면 null", async () => {
    const e1 = new Error("gemini");
    const e2 = new Error("deepl");
    state.geminiHandler = () => {
        throw e1;
    };
    state.deeplHandler = () => {
        throw e2;
    };
    assert.equal(await translateText("原文"), null);
    assert.deepEqual(state.captured, [e1, e2]);
});
