import { readFile } from "node:fs/promises";
import path from "node:path";

/** Load a prompt from /prompts and fill {{placeholders}}. */
export async function loadPrompt(name: string, vars: Record<string, string> = {}) {
  const raw = await readFile(path.join(process.cwd(), "prompts", `${name}.md`), "utf8");
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));
}
