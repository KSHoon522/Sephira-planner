import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { NavTabs } from "@/components/NavTabs";
import "./globals.css";

// Galmuri (OFL-1.1, quiple): Korean pixel font in the spirit of the game's UI
const galmuri11 = localFont({
  src: [
    { path: "./fonts/galmuri/Galmuri11.woff2", weight: "400" },
    { path: "./fonts/galmuri/Galmuri11-Bold.woff2", weight: "700" },
  ],
  variable: "--font-galmuri11",
  display: "swap",
});
const galmuri9 = localFont({ src: "./fonts/galmuri/Galmuri9.woff2", variable: "--font-galmuri9", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "세피리아 배치 플래너",
  description: "세피리아 아티팩트·석판 배낭 배치 시뮬레이터 및 자동 최적화 툴",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`h-full ${galmuri11.variable} ${galmuri9.variable}`}>
      <body className="min-h-full flex flex-col">
        <header className="min-h-12 shrink-0 flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-1 bg-[var(--frame-dark)] border-b-2 border-[var(--frame)]">
          <Link href="/" className="flex items-baseline gap-2 whitespace-nowrap">
            <span className="text-lg font-bold tracking-wide text-[var(--accent)] px-shadow">SEPHIRIA</span>
            <span className="text-[var(--fg)]">배치 플래너</span>
          </Link>
          <NavTabs />
        </header>
        <main className="flex-1 min-h-0">{children}</main>
      </body>
    </html>
  );
}
