import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * HTTP Basic Auth in front of the whole app (the desk can send email from the fund account and spend API quotas).
 * Set APP_PASSWORD (and optionally APP_USER, default "allin"). If APP_PASSWORD is unset, auth is off (local dev).
 * The Vercel Cron route is excluded: it is protected by CRON_SECRET instead.
 */
export function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const user = process.env.APP_USER || "allin";
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const [u, ...rest] = atob(header.slice(6)).split(":");
      if (u === user && rest.join(":") === password) return NextResponse.next();
    } catch {
      /* fall through to 401 */
    }
  }
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="All In Capital screening desk"' } });
}

export const config = {
  matcher: ["/((?!api/cron/|_next/static|_next/image|favicon.ico).*)"],
};
