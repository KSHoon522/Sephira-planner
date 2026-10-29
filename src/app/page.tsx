"use client";
import { useBag } from "@/store/useBag";
import { BagGrid } from "@/components/BagGrid";
import { Palette } from "@/components/Palette";
import { Inventory } from "@/components/Inventory";
import { ControlPanel } from "@/components/ControlPanel";

export default function PlannerPage() {
  const bag = useBag();
  return (
    <div className="grid gap-2 p-2 lg:h-[calc(100vh-50px)] grid-cols-1 lg:grid-cols-[320px_1fr_340px]">
      <aside className="px-panel min-h-0 h-[60vh] lg:h-auto overflow-hidden">
        <Palette bag={bag} />
      </aside>
      <section className="min-h-0 overflow-auto scroll-thin p-2 flex flex-col gap-4">
        <div className="flex items-start gap-4 flex-wrap">
          <BagGrid bag={bag} />
          <div className="flex-1 min-w-[280px] max-w-[440px] px-panel p-3">
            <h3 className="px-title mb-2">보유 아이템</h3>
            <Inventory bag={bag} />
          </div>
        </div>
      </section>
      <aside className="min-h-0 overflow-y-auto scroll-thin p-1">
        <ControlPanel bag={bag} />
      </aside>
    </div>
  );
}
