import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "세피리아 배치 플래너",
  description: "세피리아 아티팩트·석판 배낭 배치 시뮬레이터 및 자동 최적화 툴",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--fg)]">
        <header className="h-12 shrink-0 border-b border-[var(--line)] flex items-center gap-6 px-4 bg-[var(--panel)]">
          <Link href="/" className="font-semibold tracking-tight">
            <span className="text-[var(--accent)]">Sephiria</span> 배치 플래너
          </Link>
          <nav className="flex gap-4 text-sm text-[var(--muted)]">
            <Link href="/" className="hover:text-[var(--fg)]">배치</Link>
            <Link href="/import" className="hover:text-[var(--fg)]">스크린샷 인식</Link>
            <Link href="/db" className="hover:text-[var(--fg)]">데이터</Link>
          </nav>
        </header>
        <main className="flex-1 min-h-0">{children}</main>
      </body>
    </html>
  );
}
