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
        className={`${cls} flex items-center justify-center rounded-sm text-[10px] leading-tight text-center font-medium overflow-hidden select-none`}
        style={{ width: size, height: size, background: "color-mix(in oklab, var(--rc) 22%, var(--cell))", color: "var(--rc)", border: "1px solid color-mix(in oklab, var(--rc) 50%, transparent)", borderRadius: kind === "tablet" ? 2 : 6 }}
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
      onError={() => setFailed(true)} />
  );
}
