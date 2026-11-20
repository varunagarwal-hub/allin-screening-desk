// Sends one tiny JSON request to each candidate model to see which the free tier actually serves.
// Usage: npx tsx scripts/probe-gemini.ts model1 model2 ...
import { config } from "dotenv";
import { GoogleGenAI } from "@google/genai";
config({ path: ".env.local" });
(async () => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  for (const model of process.argv.slice(2)) {
    const t0 = Date.now();
    try {
      const r = await ai.models.generateContent({ model, contents: 'Return {"ok":true} as JSON.', config: { responseMimeType: "application/json" } });
      console.log(model.padEnd(24), "OK", Date.now() - t0 + "ms", (r.text ?? "").slice(0, 40).replace(/\s+/g, " "));
    } catch (e) {
      const msg = String((e as Error).message);
      const quota = msg.match(/quotaId"?:\s*"([^"]+)"|limit:\s*\d+|"quotaValue":\s*"\d+"/g)?.join(" ") ?? "";
      console.log(model.padEnd(24), "FAIL", msg.slice(0, 160).replace(/\s+/g, " "), quota);
    }
  }
})();
