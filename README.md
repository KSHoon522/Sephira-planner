# 세피리아 배치 플래너

세피리아(Sephiria) 아티팩트·석판 배낭 배치 시뮬레이터 + 자동 최적화 + 스크린샷 인식 툴.

## 실행

```bash
npm install
node scripts/fetch-icons.mjs   # 아이콘 다운로드 (최초 1회, 스크린샷 인식 정확도에 필요)
npm run dev                    # http://localhost:3000
```

## 기능

- **배치 (/)**: 6열 × 4~7행 가방. 석판/아티팩트 추가, 드래그 이동·교체, 석판 회전(R/더블클릭), 위치 고정(L), 셀별 레벨·활성 여부 실시간 계산, 콤보 태그 카운트.
- **자동 최적화**: Web Worker에서 simulated annealing으로 배치·회전 탐색. 점수 = Σ(중요도 × 유효 레벨) − 비활성 페널티. 고정(🔒) 아이템은 유지.
- **AI 목표 설정**: "샤프 아이 중심 정밀 빌드" 처럼 말로 적은 목표를 LLM(Claude 또는 Gemini)이 최적화 설정값(아티팩트 중요도·콤보 목표·관계 규칙·금빛 침 가치·비활성 페널티)으로 바꿔 제안. 배치 계산은 그대로 최적화 엔진이 함. 제안 내용을 확인한 뒤 적용 / 적용하고 최적화 / 되돌리기. (`src/ai/`, `src/app/api/ai/goals/route.ts`)
- **스크린샷 인식 (/import)**: 게임 캡쳐 → 격자 자동 감지(칸 테두리 프로파일 피팅) → 셀별
  1. 레벨 텍스트 판독 (`cur/max` 3×5 픽셀 폰트, 노란 `-N` = 석판) → 후보를 같은 ★상한 아티팩트 / 석판으로 압축
  2. 스프라이트 분리(배경색 차이 + 연결요소) → 24×24 정규화 → 색 + 실루엣 IoU + 종횡비로 참조 아이콘과 매칭
  참조 아이콘과 실제 게임 스프라이트가 다른 아이템이 많아 처음엔 오인식이 있음. 칸을 클릭해 바로잡고 "전체 학습"을 누르면 브라우저(localStorage)에 템플릿이 저장되어 이후 같은 아이템은 정확히 인식됨.
- **석판 합성**: 석판 탭의 "합성" 버튼 또는 인식 화면의 칸 지정에서 재료 2개(+각 회전)를 골라 합성 석판 생성. 효과 영역·레벨·제약 무시·배치 조건을 모두 계승. 두 재료가 모두 회전 가능하면 결과도 통째로 회전 가능(최적화도 회전시킴), 하나라도 회전 불가면 회전 불가 (`src/engine/custom.ts`). 스크린샷 인식은 '합성 석판'인 것만 판별하고(공용 스프라이트), 재료 2개와 각 회전은 칸 클릭 후 사용자가 지정.
- **데이터 (/db)**: 석판 66종 패턴, 아티팩트 308종 목록.

## AI 목표 설정 키

- 기본은 사용자가 우측 패널 **AI 목표 설정 → 설정**에 자기 API 키를 넣는 방식(BYOK). 키는 그 브라우저 localStorage에만 저장되고, 요청할 때 이 앱의 서버(`/api/ai/goals`)를 거쳐 제공자에게 전달됨.
- 서버 키를 넣으면 사용자가 키 없이 쓸 수 있음: 서버 환경 변수 `ANTHROPIC_API_KEY` 또는 `GEMINI_API_KEY`. 단 공개 배포에서는 누구나 그 키로 요청할 수 있으니 사용량 제한을 따로 걸어둘 것.
- 기본 모델: Claude `claude-opus-5-5`, Gemini `gemini-2.5-flash`. 설정에서 바꿀 수 있음.
- 정적 배포(Vercel static / GitHub Pages)로는 API 라우트가 동작하지 않음. Node 서버(`npm run build && npm start`)로 배포해야 함.

## 학습 템플릿을 배포에 포함시키기

1. `/import` 에서 캡쳐 인식 → 틀린 칸 클릭해서 바로잡기 → **전체 학습**
2. 하단 **학습 내보내기** → `learned-templates.json` 다운로드
3. 그 파일을 `src/data/learned-templates.json` 에 덮어쓰고 커밋/배포 → 모든 사용자가 같은 정확도로 시작
   (내장 + 브라우저 학습이 합쳐져 내보내지므로 반복해도 누적됨. 아이템당 최근 4샘플, 샘플당 ≈3KB)

## 구조

```
src/engine/   grid.ts(레벨 계산), optimize.ts(최적화), optimize.worker.ts, catalog.ts, types.ts
src/ai/       goals.ts(요청/응답 타입·스키마·검증), prompt.ts(서버 전용: 프롬프트 생성)
src/app/api/ai/goals/route.ts   LLM 호출 (Claude SDK / Gemini REST)
src/data/     tablets.json, artifacts.json (빌드 산출물), *.raw.json (원본 스크랩), artifacts.ko.json
src/vision/   signature.ts(셀 이미지 시그니처), templates.ts(아이콘/학습 템플릿 매칭)
src/store/    useBag.ts(상태+localStorage), useOptimizer.ts
src/components/ BagGrid, Palette, Inventory, ControlPanel, GoalsPanel, AiGoalsPanel, TabletPattern, ItemIcon
scripts/      build-data.mjs(raw→json), fetch-icons.mjs, engine-test.mjs
```

## 규칙 요약 (구현 기준)

- 아티팩트 기본 레벨 0, ★=상한. 석판 효과 합산 후 `min(레벨, 상한)`. 레벨 < 0 이면 비활성 (콤보 카운트는 유지).
- 석판은 레벨이 없어 −칸을 석판으로 덮거나 가방 밖으로 내보내면 페널티 무효.
- 회전 가능 석판은 90° 단위 회전(시계방향). 조건부 석판(정의/깃발/차양/선의)은 위치 조건 미충족 시 무효.
- 아티팩트 위치 제약: 최상단 / 최하단(열 기준) / 가장자리 / 안쪽 / 양옆 빈칸. 석판의 "무시" 효과로 해제 가능.
- 미구현: 각인 석판, 신비 슬롯, 지혜(Wisdom) 석판(효과 불명확).

데이터 출처: sephiria.tools (1.0 게임 파일 기반), 나무위키 세피리아/석판·아티팩트.
폰트: [Galmuri](https://github.com/quiple/galmuri) (SIL OFL 1.1, `src/app/fonts/galmuri/LICENSE.txt`).
