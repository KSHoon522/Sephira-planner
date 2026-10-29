"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "배치" },
  { href: "/import", label: "스크린샷 인식" },
  { href: "/db", label: "데이터" },
];

export function NavTabs() {
  const path = usePathname();
  return (
    <nav className="flex gap-1">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`px-btn px-btn-sm whitespace-nowrap ${path === t.href ? "px-btn-on" : ""}`}>{t.label}</Link>
      ))}
    </nav>
  );
}
