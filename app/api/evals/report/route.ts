import { trustReportMarkdown } from "@/lib/evals";

/** Trust report as Markdown (download). */
export async function GET() {
  const md = await trustReportMarkdown();
  return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": 'attachment; filename="trust-report.md"' } });
}
