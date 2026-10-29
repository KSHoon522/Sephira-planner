import Anthropic from "@anthropic-ai/sdk";
import { connection } from "next/server";
import { AI_PROVIDERS, LIMITS, proposalSchema, type AiGoalRequest, type AiGoalResponse, type AiProvider, type AiStatusResponse } from "@/ai/goals";
import { SYSTEM_PROMPT, buildUserMessage } from "@/ai/prompt";

const SERVER_KEY_ENV: Record<AiProvider, string> = { claude: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY" };

class AiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Which providers can run without the user's own key (key set in the server environment). */
export async function GET() {
  await connection();
  const body: AiStatusResponse = { serverKeys: { claude: !!process.env[SERVER_KEY_ENV.claude], gemini: !!process.env[SERVER_KEY_ENV.gemini] } };
  return Response.json(body);
}

export async function POST(request: Request) {
  try {
    const req = parseRequest(await request.json().catch(() => null));
    const key = request.headers.get("x-ai-key")?.trim() || process.env[SERVER_KEY_ENV[req.provider]];
    if (!key) throw new AiError(400, `${AI_PROVIDERS[req.provider].label} API 키가 없습니다. 설정에서 키를 입력하세요.`);
    const model = req.model || AI_PROVIDERS[req.provider].defaultModel;

    const artifactRefs = req.bag.items.filter((i) => i.kind === "artifact").map((i) => i.ref);
    const schema = proposalSchema(artifactRefs, req.bag.items.map((i) => i.ref));
    const user = buildUserMessage(req);
    const text = req.provider === "claude" ? await callClaude(key, model, user, schema) : await callGemini(key, model, user, schema);

    let proposal;
    try { proposal = JSON.parse(text); } catch { throw new AiError(502, "모델 응답을 JSON으로 읽지 못했습니다. 다시 시도하세요."); }
    const body: AiGoalResponse = { proposal, model };
    return Response.json(body);
  } catch (e) {
    const status = e instanceof AiError ? e.status : 500;
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: message }, { status });
  }
}

function parseRequest(body: unknown): AiGoalRequest {
  const b = body as AiGoalRequest | null;
  if (!b || typeof b !== "object" || !b.bag || !Array.isArray(b.bag.items)) throw new AiError(400, "잘못된 요청입니다.");
  if (b.provider !== "claude" && b.provider !== "gemini") throw new AiError(400, "지원하지 않는 AI 제공자입니다.");
  if (b.model && !/^[\w.\-]{1,80}$/.test(b.model)) throw new AiError(400, "모델 이름 형식이 올바르지 않습니다.");
  if (typeof b.prompt !== "string" || !b.prompt.trim()) throw new AiError(400, "목표를 입력하세요.");
  if (b.prompt.length > LIMITS.prompt) throw new AiError(400, `목표는 ${LIMITS.prompt}자 이내로 입력하세요.`);
  if (b.bag.items.length > LIMITS.items) throw new AiError(400, `아이템이 너무 많습니다 (최대 ${LIMITS.items}).`);
  if (!b.bag.items.every((i) => /^[AT]\d{1,3}$/.test(i.ref) && typeof i.defId === "string")) throw new AiError(400, "잘못된 아이템 목록입니다.");
  if (!b.bag.items.some((i) => i.kind === "artifact")) throw new AiError(400, "가방에 아티팩트를 먼저 추가하세요.");
  return b;
}

async function callClaude(apiKey: string, model: string, user: string, schema: Record<string, unknown>): Promise<string> {
  // explicit key; authToken: null keeps the SDK from picking up other ambient credentials
  const client = new Anthropic({ apiKey, authToken: null });
  try {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }],
    });
    if (res.stop_reason === "refusal") throw new AiError(422, "모델이 요청을 거절했습니다. 목표 문장을 바꿔 다시 시도하세요.");
    if (res.stop_reason === "max_tokens") throw new AiError(502, "응답이 너무 길어 잘렸습니다. 목표를 더 짧게 적어보세요.");
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError(401, "Claude API 키가 올바르지 않습니다.");
    if (e instanceof Anthropic.PermissionDeniedError) throw new AiError(403, "이 키로는 해당 모델을 쓸 수 없습니다.");
    if (e instanceof Anthropic.NotFoundError) throw new AiError(404, `모델을 찾을 수 없습니다: ${model}`);
    if (e instanceof Anthropic.RateLimitError) throw new AiError(429, "요청 한도를 넘었습니다. 잠시 후 다시 시도하세요.");
    if (e instanceof Anthropic.BadRequestError) throw new AiError(400, `요청 오류: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new AiError(502, `Claude API 오류 (${e.status ?? "연결"}): ${e.message}`);
    throw e;
  }
}

async function callGemini(apiKey: string, model: string, user: string, schema: Record<string, unknown>): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const post = (withSchema: boolean) => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: withSchema ? user : `${user}\n\n다음 JSON 스키마에 맞는 JSON만 출력:\n${JSON.stringify(schema)}` }] }],
      generationConfig: { responseMimeType: "application/json", ...(withSchema ? { responseJsonSchema: schema } : {}) },
    }),
  });
  let res: Response;
  try {
    res = await post(true);
    // older models reject parts of the JSON schema: retry with the schema in the prompt instead
    if (res.status === 400) res = await post(false);
  } catch (e) {
    throw new AiError(502, `Gemini 서버에 연결하지 못했습니다: ${e instanceof Error ? e.message : e}`);
  }
  const data = await res.json().catch(() => null) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  } | null;
  if (!res.ok) {
    const msg = data?.error?.message ?? res.statusText;
    if (res.status === 400 && /api key/i.test(msg)) throw new AiError(401, "Gemini API 키가 올바르지 않습니다.");
    if (res.status === 403) throw new AiError(403, `Gemini 권한 오류: ${msg}`);
    if (res.status === 404) throw new AiError(404, `모델을 찾을 수 없습니다: ${model}`);
    if (res.status === 429) throw new AiError(429, "Gemini 요청 한도를 넘었습니다. 잠시 후 다시 시도하세요.");
    throw new AiError(502, `Gemini API 오류 (${res.status}): ${msg}`);
  }
  if (data?.promptFeedback?.blockReason) throw new AiError(422, `Gemini가 요청을 차단했습니다 (${data.promptFeedback.blockReason}).`);
  const cand = data?.candidates?.[0];
  if (cand?.finishReason === "MAX_TOKENS") throw new AiError(502, "응답이 너무 길어 잘렸습니다. 목표를 더 짧게 적어보세요.");
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new AiError(502, `Gemini 응답이 비어 있습니다 (${cand?.finishReason ?? "알 수 없음"}).`);
  return text;
}
