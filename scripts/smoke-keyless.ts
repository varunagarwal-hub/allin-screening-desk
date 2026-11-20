// Quick check of the research clients that need no API key. Usage: npx tsx scripts/smoke-keyless.ts
import { googleNews, jinaRead } from "../lib/research";
(async () => {
  const hits = await googleNews("All In Capital Kushal Bhagia", undefined, 3);
  console.log("RSS hits:", hits.length, hits.map((h) => h.title.slice(0, 80)));
  const page = await jinaRead("https://example.com/");
  console.log("Jina:", "error" in page ? page.error : `${page.title} (${page.text.length} chars)`);
  const ex = await jinaRead("https://stocksathi.example/");
  console.log(".example guard:", "error" in ex ? ex.error : "FETCHED (unexpected)");
})();
