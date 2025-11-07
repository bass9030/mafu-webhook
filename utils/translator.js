const deepl = require("deepl-node");
const glossary = require("./glossary.json");
const systemInstruction =
    "Translate japanese to korean. Only translated sentences should be displayed in the response. Some words should be translated as below.\n" +
    glossary.map((e) => `${e.source} is ${e.target}`).join(". ");
const { GoogleGenAI } = require("@google/genai");
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenAI({ apiKey });
const sendDebugLog = require("./DebugLogger");

/**
 * 번역 (DeepL 번역)
 * @param {string} source 번역할 언어(auto: 자동인식)
 * @param {string} target 번역될 언어
 * @param {string} query 번역할 텍스트
 */
async function translateTextDeepL(source, target, query) {
    const translator = new deepl.Translator(process.env.DEEPL_API_KEY);

    // query = convertToHalf(query);
    let response = await translator.translateText(
        query,
        !!source ? source : null,
        target,
        {
            glossary: process.env.DEEPL_GLOSSARY_ID,
        }
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
        sendDebugLog(
            `Gemini translate fallback. try deepL translate.\nStackTrace:\`\`\`\n${e.stack}\n\`\`\``
        );
        result = await translateTextDeepL("ja", "ko", text);
    }

    return result;
}

/**
 * 번역 (Gemini)
 * @param {string} query 번역할 텍스트
 */
async function translateTextGemini(query) {
    const result = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: query,
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
            systemInstruction: systemInstruction,
        },
    });
    return result.text.replace(/\\/g, "\\\\\\");
}

module.exports = translateText;
