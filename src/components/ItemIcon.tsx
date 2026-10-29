"use client";
import { useState } from "react";
import type { Rarity } from "@/engine/types";

export function iconUrl(id: string) {
  return `/icons/${id}.png`;
}

export function ItemIcon({ id, label, rarity, size = 36, kind }: {
  id: string; label: string; rarity: Rarity; size?: number; kind: "artifact" | "tablet";
}) {
  const [failed, setFailed] = useState(false);
  const cls = `rarity-${rarity}`;
  if (failed) {
    return (
      <div
        className={`${cls} flex items-center justify-center text-tiny leading-tight text-center overflow-hidden select-none px-shadow`}
        style={{ width: size, height: size, background: "color-mix(in oklab, var(--rc) 18%, var(--cell))", color: "var(--rc)", boxShadow: `inset 0 0 0 ${kind === "tablet" ? 2 : 1}px color-mix(in oklab, var(--rc) 50%, transparent)` }}
        title={label}
      >
        {label.slice(0, 4)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={iconUrl(id)} alt={label} width={size} height={size} draggable={false}
      style={{ width: size, height: size, imageRendering: "pixelated", objectFit: "contain" }}
      // a server-rendered image can fail before hydration attaches onError
      ref={(el) => { if (el?.complete && el.naturalWidth === 0) setFailed(true); }}
      onError={() => setFailed(true)} />
  );
}
