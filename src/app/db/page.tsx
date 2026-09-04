import { TABLETS, ARTIFACTS, RARITY_KO, CATEGORY_KO, RESTRICTION_KO } from "@/engine/catalog";
import { TabletPattern } from "@/components/TabletPattern";
import { ItemIcon } from "@/components/ItemIcon";
import { condKo } from "@/engine/labels";

export default function DbPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto flex flex-col gap-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">석판 ({TABLETS.length})</h2>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {TABLETS.map((t) => (
            <div key={t.id} className={`rarity-${t.rarity} flex items-center gap-3 p-2 rounded border border-[var(--line)] bg-[var(--panel)]`}>
              <ItemIcon id={t.id} label={t.nameKo} rarity={t.rarity} kind="tablet" size={36} />
              <div className="flex-1 min-w-0 text-sm">
                <div><span style={{ color: "var(--rc)" }}>{RARITY_KO[t.rarity]}</span> <b style={{ color: "var(--rc)" }}>{t.nameKo}</b> <span className="text-[var(--muted)] text-xs">{t.name}</span></div>
                <div className="text-[11px] text-[var(--muted)]">{t.rotatable ? "회전 가능" : "회전 불가"}{t.condition && ` · 조건: ${condKo(t.condition)}`}</div>
              </div>
              <TabletPattern def={t} cell={11} />
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">아티팩트 ({ARTIFACTS.length})</h2>
        <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {ARTIFACTS.map((a) => (
            <div key={a.id} className={`rarity-${a.rarity} flex items-center gap-2 p-1.5 rounded border border-[var(--line)] bg-[var(--panel)] text-sm`} title={a.effect}>
              <ItemIcon id={a.id} label={a.nameKo} rarity={a.rarity} kind="artifact" size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate"><span style={{ color: "var(--rc)" }}>{RARITY_KO[a.rarity]}</span> <b style={{ color: "var(--rc)" }}>{a.nameKo}</b> <span className="text-[var(--muted)] text-xs">{a.name}</span></div>
                <div className="text-[11px] text-[var(--muted)] truncate">★{a.maxLevel} {a.categories.map((c) => `#${CATEGORY_KO[c] ?? c}`).join(" ")}{a.restriction && ` · 제약:${RESTRICTION_KO[a.restriction]}`}{a.weapon && ` · ${a.weapon}`}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
