// Thin client for the FastAPI backend. Base URL is configurable for deploys.
import type { PipelineState, RunnableForm, StepId } from "./pipeline/plan";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.detail ?? res.statusText);
  return body as T;
}

export interface RunStatus { running: boolean; lines: string[] }
export interface RoomAvailability { room: string; bookings: string[]; free: boolean; conflicts: string[] }

export const pipelineApi = {
  state: () => call<PipelineState>("/api/v1/pipeline/state"),
  updateProfile: (patch: Record<string, unknown>) => call<PipelineState>("/api/v1/pipeline/profile", { method: "PUT", json: patch }),
  setCheck: (step: StepId, check: string, value: boolean) => call<PipelineState>("/api/v1/pipeline/progress", { method: "PUT", json: { step, check, value } }),
  setData: (step: StepId, dataKey: string, dataValue: string) => call<PipelineState>("/api/v1/pipeline/progress", { method: "PUT", json: { step, dataKey, dataValue } }),
  startRun: (form: RunnableForm) => call<{ ok: boolean }>(`/api/v1/pipeline/run/${form}`, { method: "POST" }),
  runStatus: (form: RunnableForm) => call<RunStatus>(`/api/v1/pipeline/run/${form}`),
  eeAvailability: () => call<RoomAvailability[]>("/api/v1/pipeline/ee-availability"),
};
