import {
    GoogleGenAI,
    HarmBlockThreshold,
    HarmCategory,
} from "@google/genai";
import { Translator } from "deepl-node";
import glossary from "./glossary.json";
import { sendErrorLog } from "./DebugLogger";

const systemInstruction =
    "Translate Japanese to Korean. Output only translated sentences. " +
    glossary.map(({ source, target }) => `${source} is ${target}`).join(". ");

let geminiClient: GoogleGenAI | undefined;

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
}

async function translateTextDeepL(query: string): Promise<string> {
    const translator = new Translator(requiredEnv("DEEPL_API_KEY"));
    const response = await translator.translateText(query, "ja", "ko", {
        glossary: process.env.DEEPL_GLOSSARY_ID,
    });
    return Array.isArray(response) ? response[0]?.text ?? "" : response.text;
}

async function translateTextGemini(query: string): Promise<string> {
    geminiClient ??= new GoogleGenAI({
        apiKey: requiredEnv("GEMINI_API_KEY"),
    });
    const result = await geminiClient.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: query,
        config: {
            safetySettings: [
                HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                HarmCategory.HARM_CATEGORY_HARASSMENT,
                HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            ].map((category) => ({
                category,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            })),
            systemInstruction,
        },
    });
    return (result.text ?? "").replace(/\\/g, "\\\\\\");
}

export default async function translateText(text: string): Promise<string> {
    if (text.length === 0) return "";
    try {
        return await translateTextGemini(text);
    } catch (error) {
        sendErrorLog(error);
        return translateTextDeepL(text);
    }
}
