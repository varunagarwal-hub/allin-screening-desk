import { Suspense } from "react";
import { AppDetail } from "./detail";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <AppDetail />
    </Suspense>
  );
}
