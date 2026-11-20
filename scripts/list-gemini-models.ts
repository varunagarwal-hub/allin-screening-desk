// Lists Gemini models visible to GEMINI_API_KEY. Usage: npx tsx scripts/list-gemini-models.ts
import { config } from "dotenv";
import { GoogleGenAI } from "@google/genai";
config({ path: ".env.local" });
(async () => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const pager = await ai.models.list();
  for await (const m of pager) {
    const acts = (m.supportedActions ?? []).join(",");
    if (/generateContent|embedContent/.test(acts)) console.log(m.name?.replace("models/", "").padEnd(45), acts, m.inputTokenLimit ?? "");
  }
})();
