import type {
  CharacterPatch,
  CreateCharacterInput,
  CreateLocationInput,
  CreateRelationshipInput,
  CreateSaveInput,
  CreateTurnInput,
  LocationPatch,
  ModelConfig,
  ModelProbeInput,
  ModelProbeResult,
  PatchTurnDraftInput,
  RelationshipPatch,
  Save,
  SaveExport,
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
  login: (password: string, username = "admin") =>
    request<Session>("/api/auth/login", { method: "POST", body: { username, password } }),
  logout: () => request<Session>("/api/auth/logout", { method: "POST" }),
  modelConfig: () => request<ModelConfig>("/api/model-config"),
  updateModelConfig: (body: Partial<ModelConfig> & { apiKey?: string }) =>
    request<ModelConfig>("/api/model-config", { method: "PUT", body }),
  probeModelConfig: (body: ModelProbeInput) =>
    request<ModelProbeResult>("/api/model-config/probe", { method: "POST", body }),
  saveModelConfig: (id: string) => request<ModelConfig>(`/api/saves/${id}/model-config`),
  updateSaveModelConfig: (id: string, body: Partial<ModelConfig> & { apiKey?: string }) =>
    request<Save>(`/api/saves/${id}/model-config`, { method: "PUT", body }),
  clearSaveModelConfig: (id: string) => request<Save>(`/api/saves/${id}/model-config`, { method: "DELETE" }),
  saves: () => request<SaveListItem[]>("/api/saves"),
  save: (id: string) => request<Save>(`/api/saves/${id}`),
  patchSave: (id: string, body: Partial<Pick<Save, "name" | "description" | "settings" | "worldMemory">>) =>
    request<Save>(`/api/saves/${id}`, { method: "PATCH", body }),
  exportSave: (id: string) => request<SaveExport>(`/api/saves/${id}/export`),
  importSave: (body: SaveImport) => request<Save>("/api/saves/import", { method: "POST", body }),
  rollbackSave: (id: string) => request<Save>(`/api/saves/${id}/rollback`, { method: "POST" }),
  patchCharacter: (saveId: string, characterId: string, body: CharacterPatch) =>
    request<Save>(`/api/saves/${saveId}/characters/${characterId}`, { method: "PATCH", body }),
  createCharacter: (saveId: string, body: CreateCharacterInput) =>
    request<Save>(`/api/saves/${saveId}/characters`, { method: "POST", body }),
  deleteCharacter: (saveId: string, characterId: string) =>
    request<Save>(`/api/saves/${saveId}/characters/${characterId}`, { method: "DELETE" }),
  createLocation: (saveId: string, body: CreateLocationInput) =>
    request<Save>(`/api/saves/${saveId}/locations`, { method: "POST", body }),
  patchLocation: (saveId: string, locationId: string, body: LocationPatch) =>
    request<Save>(`/api/saves/${saveId}/locations/${locationId}`, { method: "PATCH", body }),
  deleteLocation: (saveId: string, locationId: string) =>
    request<Save>(`/api/saves/${saveId}/locations/${locationId}`, { method: "DELETE" }),
  createRelationship: (saveId: string, body: CreateRelationshipInput) =>
    request<Save>(`/api/saves/${saveId}/relationships`, { method: "POST", body }),
  patchRelationship: (saveId: string, relationshipId: string, body: RelationshipPatch) =>
    request<Save>(`/api/saves/${saveId}/relationships/${relationshipId}`, { method: "PATCH", body }),
  deleteRelationship: (saveId: string, relationshipId: string) =>
    request<Save>(`/api/saves/${saveId}/relationships/${relationshipId}`, { method: "DELETE" }),
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
  patchTurnDraft: (id: string, body: PatchTurnDraftInput) =>
    request<TurnJob>(`/api/turn-jobs/${id}/draft`, { method: "PATCH", body }),
  cancelTurnJob: (id: string) => request<TurnJob>(`/api/turn-jobs/${id}/cancel`, { method: "POST" }),
  retryTurnJob: (id: string) => request<TurnJob>(`/api/turn-jobs/${id}/retry`, { method: "POST" }),
  acceptTurn: (id: string) => request<Save>(`/api/turns/${id}/accept`, { method: "POST" })
};
