const deepl = require("deepl-node");
const fs = require("fs");
const path = require("path");
const glossary = require("../data/glossary.json");
const SYSTEM_INSTRUCTION = fs.readFileSync(
    path.join(__dirname, "..", "prompt", "translator.md"),
    { encoding: "utf-8" },
);
const { GoogleGenAI } = require("@google/genai");
const { sendErrorLog } = require("./DebugLogger");

/** @type {GoogleGenAI | null} 첫 번역 시 생성 */
let genAI = null;
/** @type {deepl.Translator | null} 첫 생성 성공 후 재사용 (키가 없으면 생성 시 예외 → 매번 재시도) */
let deeplTranslator = null;

function getGenAI() {
    if (!genAI) genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    return genAI;
}

function getDeepLTranslator() {
    if (!deeplTranslator)
        deeplTranslator = new deepl.Translator(process.env.DEEPL_API_KEY);
    return deeplTranslator;
}

/**
 * 번역 (DeepL 번역)
 * @param {string} source 번역할 언어(auto: 자동인식)
 * @param {string} target 번역될 언어
 * @param {string} query 번역할 텍스트
 */
async function translateTextDeepL(source, target, query) {
    const translator = getDeepLTranslator();

    // query = convertToHalf(query);
    let response = await translator.translateText(
        query,
        !!source ? source : null,
        target,
        {
            glossary: process.env.DEEPL_GLOSSARY_ID,
        },
    );

    return response.text;
}

/**
 * Gemini로 번역을 시도하고 실패시 DeepL로 번역합니다.
 * @param {string} text 번역할 텍스트
 */
async function translateText(text) {
    let result = null;

    if (text.length == 0) return "";

    try {
        result = await translateTextGemini(text);
    } catch (e) {
        sendErrorLog(e);
        try {
            result = await translateTextDeepL("ja", "ko", text);
        } catch (e) {
            // TODO: fallback 처리(아마 HdTrans 쓸듯?)
            sendErrorLog(e);
        }
    }

    return result;
}

/**
 * 번역 (Gemini)
 * @param {string} query 번역할 텍스트
 */
async function translateTextGemini(query) {
    const instruction = SYSTEM_INSTRUCTION.replace(
        "{{GLOSSARY}}",
        glossary.map((item) => `${item.ja} → ${item.ko}`).join("\n"),
    ).replace("{{TEXT}}", query);

    const result = await getGenAI().models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: instruction,
        config: {
            safetySettings: [
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_NONE",
                },
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_NONE",
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_NONE",
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_NONE",
                },
            ],
            // systemInstruction: instruction,
        },
    });
    return result.text.replace(/\\/g, "\\\\\\");
}

module.exports = translateText;
