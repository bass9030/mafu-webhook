import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Translator } from "deepl-node";
import glossary from "./glossary.json";

function csvCell(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
    const apiKey = process.env.DEEPL_API_KEY;
    if (!apiKey) throw new Error("DEEPL_API_KEY is required");
    const csvPath = path.join(__dirname, "glossary.csv");
    const csv = [
        "source,target",
        ...glossary.map(({ source, target }) =>
            `${csvCell(source)},${csvCell(target)}`,
        ),
    ].join("\n");
    await fs.writeFile(csvPath, csv, "utf8");

    const translator = new Translator(apiKey);
    const previous = (await translator.listGlossaries())[0];
    if (previous) await translator.deleteGlossary(previous.glossaryId);
    await translator.createGlossaryWithCsv(
        `mahook_glossary_rev_${Date.now()}`,
        "ja",
        "ko",
        csvPath,
    );
    console.log("Glossary upload complete");
}

void main();
