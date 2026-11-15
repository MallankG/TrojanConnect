// Thin client for the FastAPI backend. Base URL is configurable for deploys.
import type {
  PipelineState,
  RecognitionApplicationStatus,
  RecognitionOfficer,
  RecognitionRequirement,
  RunnableForm,
  StepId,
} from "./pipeline/plan";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function errorMessage(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return null;
  const messages = detail.flatMap(item => {
    if (!item || typeof item !== "object" || !("msg" in item) || typeof item.msg !== "string") return [];
    const location = "loc" in item && Array.isArray(item.loc) ? item.loc.slice(1).join(".") : "";
    return [location ? `${location}: ${item.msg}` : item.msg];
  });
  return messages.length ? messages.join("; ") : null;
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    // Custom header forces a CORS preflight; the backend rejects mutations without it (CSRF guard).
    headers: { "content-type": "application/json", "X-TrojanConnect-Client": "web", ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorMessage(body?.detail) ?? res.statusText);
  return body as T;
}

export interface RunStatus { running: boolean; lines: string[] }
export interface RoomAvailability { room: string; bookings: string[]; free: boolean; conflicts: string[] }
export type RecognitionSetup = Partial<Pick<
  NonNullable<PipelineState["recognition"]>,
  "pathway" | "engageGroupUrl" | "additionalMemberCount" | "acceptedPositionCount"
>>;

export type AgentAction =
  | { type: "form"; formId: string; step: StepId | null; running: boolean }
  | { type: "reset" }
  | { type: "field"; key: string };
export interface AgentInfo { configured: boolean; model: string }
export interface AgentReply { reply: string; actions: AgentAction[]; tools: { tool: string; ok: boolean; error: string | null }[]; state: PipelineState; model: string }

export const pipelineApi = {
  state: () => call<PipelineState>("/api/v1/pipeline/state"),
  updateProfile: (patch: Record<string, unknown>) => call<PipelineState>("/api/v1/pipeline/profile", { method: "PUT", json: patch }),
  setCheck: (step: StepId, check: string, value: boolean) => call<PipelineState>("/api/v1/pipeline/progress", { method: "PUT", json: { step, check, value } }),
  setData: (step: StepId, dataKey: string, dataValue: string) => call<PipelineState>("/api/v1/pipeline/progress", { method: "PUT", json: { step, dataKey, dataValue } }),
  setRecognitionCheck: (check: string, value: boolean) => call<PipelineState>("/api/v1/pipeline/recognition/progress", { method: "PUT", json: { check, value } }),
  updateRecognitionSetup: (patch: RecognitionSetup) => call<PipelineState>("/api/v1/pipeline/recognition/setup", { method: "PUT", json: patch }),
  setOfficerRequirement: (role: RecognitionOfficer, requirement: RecognitionRequirement, value: boolean) =>
    call<PipelineState>("/api/v1/pipeline/recognition/officer-progress", { method: "PUT", json: { role, requirement, value } }),
  setRecognitionStatus: (status: RecognitionApplicationStatus) =>
    call<PipelineState>("/api/v1/pipeline/recognition/status", { method: "PUT", json: { status } }),
  startRun: (form: RunnableForm) => call<{ ok: boolean }>(`/api/v1/pipeline/run/${form}`, { method: "POST" }),
  runStatus: (form: RunnableForm) => call<RunStatus>(`/api/v1/pipeline/run/${form}`),
  eeAvailability: () => call<RoomAvailability[]>("/api/v1/pipeline/ee-availability"),
  reset: () => call<PipelineState>("/api/v1/pipeline/reset", { method: "POST" }),
  agentInfo: () => call<AgentInfo>("/api/v1/pipeline/agent"),
  agentChat: (message: string, history: { role: "user" | "assistant"; text: string }[]) =>
    call<AgentReply>("/api/v1/pipeline/agent/chat", { method: "POST", json: { message, history } }),
};
