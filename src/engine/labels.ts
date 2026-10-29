import type { Relation } from "./types";

export function condKo(c: string | null) {
  switch (c) {
    case "left-end": return "왼쪽 끝";
    case "right-end": return "오른쪽 끝";
    case "left-or-right-end": return "좌/우 끝";
    case "top": return "최상단";
    case "bottom": return "최하단";
    default: return "";
  }
}

export const REL_KO: Record<Relation, string> = {
  above: "바로 위에", below: "바로 아래에", left: "바로 왼쪽에", right: "바로 오른쪽에", adjacent: "상하좌우 인접", "same-row": "같은 가로줄", "same-col": "같은 세로줄",
};

export function reasonKo(r: string) {
  switch (r) {
    case "disabled": return "석판 무효화";
    case "negative": return "레벨 음수";
    case "restriction": return "위치 제약";
    case "weapon": return "무기 불일치";
    case "condition": return "조건";
    default: return r;
  }
}
