import type {
  CharacterPatch,
  CreateSaveInput,
  CreateTurnInput,
  ModelConfig,
  ModelProbeInput,
  ModelProbeResult,
  Save,
  SaveImport,
  SaveGenerationJob,
  SaveListItem,
  Session,
  TurnJob
} from "@fantasy-world/shared";

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { body, ...initOptions } = options;
  const headers = new Headers(initOptions.headers);
  const init: RequestInit = {
    ...initOptions,
    credentials: "include",
    headers
  };

  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
    throw new Error(payload?.error?.message ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export const api = {
  session: () => request<Session>("/api/auth/session"),
  login: (password: string) => request<Session>("/api/auth/login", { method: "POST", body: { password } }),
  logout: () => request<Session>("/api/auth/logout", { method: "POST" }),
  modelConfig: () => request<ModelConfig>("/api/model-config"),
  updateModelConfig: (body: Partial<ModelConfig> & { apiKey?: string }) =>
    request<ModelConfig>("/api/model-config", { method: "PUT", body }),
  probeModelConfig: (body: ModelProbeInput) =>
    request<ModelProbeResult>("/api/model-config/probe", { method: "POST", body }),
  saves: () => request<SaveListItem[]>("/api/saves"),
  save: (id: string) => request<Save>(`/api/saves/${id}`),
  patchSave: (id: string, body: Partial<Pick<Save, "name" | "description" | "settings" | "worldMemory">>) =>
    request<Save>(`/api/saves/${id}`, { method: "PATCH", body }),
  exportSave: (id: string) => request<Save>(`/api/saves/${id}/export`),
  importSave: (body: SaveImport) => request<Save>("/api/saves/import", { method: "POST", body }),
  rollbackSave: (id: string) => request<Save>(`/api/saves/${id}/rollback`, { method: "POST" }),
  patchCharacter: (saveId: string, characterId: string, body: CharacterPatch) =>
    request<Save>(`/api/saves/${saveId}/characters/${characterId}`, { method: "PATCH", body }),
  createGenerationJob: (body: CreateSaveInput) =>
    request<SaveGenerationJob>("/api/save-generation-jobs", { method: "POST", body }),
  generationJob: (id: string) => request<SaveGenerationJob>(`/api/save-generation-jobs/${id}`),
  cancelGenerationJob: (id: string) =>
    request<SaveGenerationJob>(`/api/save-generation-jobs/${id}/cancel`, { method: "POST" }),
  retryGenerationJob: (id: string) =>
    request<SaveGenerationJob>(`/api/save-generation-jobs/${id}/retry`, { method: "POST" }),
  acceptGenerationJob: (id: string) => request<Save>(`/api/save-generation-jobs/${id}/accept`, { method: "POST" }),
  createTurn: (saveId: string, body: CreateTurnInput) =>
    request<TurnJob>(`/api/saves/${saveId}/turns`, { method: "POST", body }),
  turnJob: (id: string) => request<TurnJob>(`/api/turn-jobs/${id}`),
  cancelTurnJob: (id: string) => request<TurnJob>(`/api/turn-jobs/${id}/cancel`, { method: "POST" }),
  retryTurnJob: (id: string) => request<TurnJob>(`/api/turn-jobs/${id}/retry`, { method: "POST" }),
  acceptTurn: (id: string) => request<Save>(`/api/turns/${id}/accept`, { method: "POST" })
};
