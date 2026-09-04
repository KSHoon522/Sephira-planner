"use client";
import { useBag } from "@/store/useBag";
import { BagGrid } from "@/components/BagGrid";
import { Palette } from "@/components/Palette";
import { Inventory } from "@/components/Inventory";
import { ControlPanel } from "@/components/ControlPanel";

export default function PlannerPage() {
  const bag = useBag();
  return (
    <div className="h-[calc(100vh-3rem)] grid" style={{ gridTemplateColumns: "340px 1fr 320px" }}>
      <aside className="border-r border-[var(--line)] bg-[var(--panel)] min-h-0">
        <Palette bag={bag} />
      </aside>
      <section className="min-h-0 overflow-auto scroll-thin p-4 flex flex-col gap-4">
        <div className="flex items-start gap-4 flex-wrap">
          <BagGrid bag={bag} />
          <div className="flex-1 min-w-[280px] max-w-[420px]">
            <h3 className="text-xs uppercase tracking-wider text-[var(--muted)] mb-2">보유 아이템</h3>
            <Inventory bag={bag} />
          </div>
        </div>
      </section>
      <aside className="border-l border-[var(--line)] min-h-0 overflow-y-auto scroll-thin p-3 bg-[var(--bg)]">
        <ControlPanel bag={bag} />
      </aside>
    </div>
  );
}
