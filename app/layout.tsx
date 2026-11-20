import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "All In Capital · Screening desk",
  description: "First-pass triage for All In Capital inbound applications",
};

const NAV = [
  ["/", "Batch"],
  ["/intake", "Intake"],
  ["/outreach", "Outreach"],
  ["/calibration", "Calibration"],
  ["/evals", "Evals"],
  ["/trust", "Trust report"],
  ["/test", "Connections"],
] as const;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              All In Capital <span className="font-normal text-zinc-500">· screening desk</span>
            </Link>
            <nav className="flex flex-wrap gap-4 text-sm text-zinc-600 dark:text-zinc-400">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="hover:text-zinc-900 dark:hover:text-white">
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
