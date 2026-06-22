// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Save, SaveListItem } from "@fantasy-world/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n.js";
import { LoadSavePage } from "./LoadSavePage.js";
import { TitlePage } from "./TitlePage.js";
import { CreateSavePage, WorldPage } from "./WorldPage.js";

const apiMock = vi.hoisted(() => ({
  saves: vi.fn(),
  save: vi.fn(),
  createGenerationJob: vi.fn(),
  generationJob: vi.fn(),
  acceptGenerationJob: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  importSave: vi.fn(),
  exportSave: vi.fn(),
  rollbackSave: vi.fn(),
  createTurn: vi.fn(),
  turnJob: vi.fn(),
  acceptTurn: vi.fn(),
  cancelTurnJob: vi.fn(),
  retryTurnJob: vi.fn(),
  patchTurnDraft: vi.fn(),
  saveModelConfig: vi.fn(),
  updateSaveModelConfig: vi.fn(),
  clearSaveModelConfig: vi.fn(),
  collaborators: vi.fn(),
  upsertCollaborator: vi.fn(),
  patchCollaborator: vi.fn(),
  removeCollaborator: vi.fn(),
  playerInputs: vi.fn(),
  createPlayerInput: vi.fn(),
  reviewPlayerInput: vi.fn(),
  patchSave: vi.fn(),
  patchCharacter: vi.fn(),
  createCharacter: vi.fn(),
  deleteCharacter: vi.fn(),
  createLocation: vi.fn(),
  patchLocation: vi.fn(),
  deleteLocation: vi.fn(),
  createRelationship: vi.fn(),
  patchRelationship: vi.fn(),
  deleteRelationship: vi.fn()
}));

vi.mock("../api/client.js", () => ({
  api: apiMock
}));

type TestRoute = "title" | "create" | "load" | "world";

function renderWithClient(route: TestRoute = "world") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: route === "title" ? TitlePage : TestPlaceholder
  });
  const createRoutePage = createRoute({
    getParentRoute: () => rootRoute,
    path: "/create",
    component: route === "create" ? CreateSavePage : TestPlaceholder
  });
  const loadRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/load",
    component: route === "load" ? LoadSavePage : TestPlaceholder
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: TestPlaceholder
  });
  const worldRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/world/$saveId",
    component: route === "world" ? () => <WorldPage saveId="save_1" /> : TestPlaceholder
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, createRoutePage, loadRoute, settingsRoute, worldRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry(route)] })
  });

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  return { ...rendered, router };
}

function TestPlaceholder() {
  return <div data-testid="route-placeholder" />;
}

function initialEntry(route: TestRoute) {
  if (route === "create") {
    return "/create";
  }

  if (route === "load") {
    return "/load";
  }

  if (route === "world") {
    return "/world/save_1";
  }

  return "/";
}

function makeSave(): Save {
  return {
    id: "save_1",
    name: "Test World",
    description: "A compact test world",
    schemaVersion: "1",
    turnNumber: 0,
    saveSeed: "seed_1",
    settings: {
      language: "en",
      turnTimeScale: "One scene",
      randomness: 25,
      contentBoundary: "PG-13",
      styleGuide: "Crisp"
    },
    worldMemory: {
      timeline: [],
      worldSummary: "A compact test world",
      locationSummaries: {
        location_1: "The first location"
      }
    },
    characters: [
      {
        id: "character_1",
        name: "Ada",
        profile: "A careful captain",
        personality: "Careful",
        longTermGoal: "Protect the harbor",
        shortTermGoal: "Find a lead",
        locationId: "location_1",
        status: "Available",
        secrets: ["Keeps a map"],
        privateMemory: ["Saw the first signal"]
      },
      {
        id: "character_2",
        name: "Bryn",
        profile: "A practical fixer",
        personality: "Direct",
        longTermGoal: "Keep trade moving",
        shortTermGoal: "Meet Ada",
        locationId: "location_1",
        status: "Available",
        secrets: [],
        privateMemory: []
      }
    ],
    locations: [
      {
        id: "location_1",
        name: "Harbor",
        description: "The first location",
        status: "Open"
      }
    ],
    relationships: [
      {
        id: "relationship_1",
        sourceCharacterId: "character_1",
        targetCharacterId: "character_2",
        label: "Trust",
        strength: 20,
        summary: "They can work together."
      }
    ],
    turns: [],
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z"
  };
}

class MockEventSource {
  onerror: (() => void) | null = null;

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit
  ) {}

  addEventListener() {}

  close() {}
}

describe("WorldPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.stubGlobal("EventSource", MockEventSource);
    await i18n.changeLanguage("en");
    apiMock.saves.mockResolvedValue([]);
    apiMock.save.mockResolvedValue(makeSave());
    apiMock.updateSaveModelConfig.mockResolvedValue(makeSave());
    apiMock.clearSaveModelConfig.mockResolvedValue(makeSave());
    apiMock.collaborators.mockResolvedValue([]);
    apiMock.playerInputs.mockResolvedValue([]);
  });

  it("renders the title screen entry actions", async () => {
    renderWithClient("title");

    expect(await screen.findByRole("heading", { name: "FantasyWorld" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create game" })).toHaveAttribute("href", "/create");
    expect(screen.getByRole("link", { name: "Load save" })).toHaveAttribute("href", "/load");
    expect(screen.getByRole("link", { name: "Model settings" })).toHaveAttribute("href", "/settings");
  });

  it("renders the create wizard and keeps world language separate from UI language", async () => {
    renderWithClient("create");

    expect(await screen.findByText("New world")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("World language"), "en");

    expect(screen.getByRole("button", { name: /Age of Mist Harbor/ })).toBeInTheDocument();

    await i18n.changeLanguage("zh");

    expect(await screen.findByText("新世界")).toBeInTheDocument();
    expect(screen.getByLabelText("存档语言")).toHaveValue("en");
  });

  it("accepts a generated draft and enters the playable world", async () => {
    const save = makeSave();
    const generationJob = {
      id: "generation_job_1",
      status: "needs_review" as const,
      input: {
        templateId: "fantasy-frontier",
        name: save.name,
        premise: save.description,
        characterSeeds: ["A", "B", "C"],
        settings: save.settings
      },
      draft: {
        id: "draft_1",
        input: {
          templateId: "fantasy-frontier",
          name: save.name,
          premise: save.description,
          characterSeeds: ["A", "B", "C"],
          settings: save.settings
        },
        save,
        createdAt: "2026-06-21T00:00:00.000Z"
      }
    };
    apiMock.createGenerationJob.mockResolvedValue(generationJob);
    apiMock.acceptGenerationJob.mockResolvedValue(save);
    const { router } = renderWithClient("create");

    await userEvent.click(await screen.findByRole("button", { name: "Draft" }));
    await userEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    expect(await screen.findByText("Draft ready")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Accept draft" }));

    await waitFor(() => expect(apiMock.acceptGenerationJob).toHaveBeenCalledWith("generation_job_1"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/world/save_1"));
  });

  it("keeps draft generation visibly active until the job finishes", async () => {
    const queuedJob = {
      id: "generation_job_active",
      status: "queued" as const,
      phase: "queued",
      input: {
        templateId: "fantasy-frontier",
        name: "Queued world",
        premise: "A queued world",
        characterSeeds: ["A", "B", "C"],
        settings: makeSave().settings
      }
    };
    const runningJob = {
      ...queuedJob,
      status: "running" as const,
      phase: "generating_world_draft"
    };
    apiMock.createGenerationJob.mockResolvedValue(queuedJob);
    apiMock.generationJob.mockResolvedValue(runningJob);
    renderWithClient("create");

    await userEvent.click(await screen.findByRole("button", { name: "Draft" }));
    await userEvent.click(screen.getByRole("button", { name: "Generate draft" }));

    expect(await screen.findByText("Generating draft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generating draft..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("polls active draft generation until a failed terminal state", async () => {
    const queuedJob = {
      id: "generation_job_failed",
      status: "queued" as const,
      phase: "queued",
      input: {
        templateId: "fantasy-frontier",
        name: "Timeout world",
        premise: "A slow world",
        characterSeeds: ["A", "B", "C"],
        settings: makeSave().settings
      }
    };
    const runningJob = {
      ...queuedJob,
      status: "running" as const,
      phase: "generating_world_draft"
    };
    const failedJob = {
      ...runningJob,
      status: "failed" as const,
      failure: {
        code: "provider_timeout",
        message: "The model generation request timed out before a response was returned"
      },
      error: "The model generation request timed out before a response was returned"
    };
    apiMock.createGenerationJob.mockResolvedValue(queuedJob);
    apiMock.generationJob.mockResolvedValueOnce(runningJob).mockResolvedValue(failedJob);
    renderWithClient("create");

    await userEvent.click(await screen.findByRole("button", { name: "Draft" }));
    await userEvent.click(screen.getByRole("button", { name: "Generate draft" }));

    expect(await screen.findByText("Generating draft")).toBeInTheDocument();
    expect(await screen.findByText("Draft generation failed", {}, { timeout: 3500 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate draft" })).toBeEnabled();
  });

  it("prefers fetched generation job updates over the initial queued mutation result", async () => {
    const save = makeSave();
    const queuedJob = {
      id: "generation_job_updated",
      status: "queued" as const,
      phase: "queued",
      input: {
        templateId: "fantasy-frontier",
        name: save.name,
        premise: save.description,
        characterSeeds: ["A", "B", "C"],
        settings: save.settings
      }
    };
    const completedJob = {
      ...queuedJob,
      status: "needs_review" as const,
      phase: "needs_review",
      draft: {
        id: "draft_1",
        input: queuedJob.input,
        save,
        createdAt: "2026-06-21T00:00:00.000Z"
      }
    };
    apiMock.createGenerationJob.mockResolvedValue(queuedJob);
    apiMock.generationJob.mockResolvedValue(completedJob);
    renderWithClient("create");

    await userEvent.click(await screen.findByRole("button", { name: "Draft" }));
    await userEvent.click(screen.getByRole("button", { name: "Generate draft" }));

    expect(await screen.findByText("Draft ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate draft" })).toBeDisabled();
  });

  it("loads an existing save from the load page", async () => {
    const save = makeSave();
    const item: SaveListItem = {
      id: save.id,
      name: save.name,
      description: save.description,
      language: save.settings.language,
      turnNumber: save.turnNumber,
      characterCount: save.characters.length,
      updatedAt: save.updatedAt
    };
    apiMock.saves.mockResolvedValue([item]);
    const { router } = renderWithClient("load");

    await userEvent.click(await screen.findByRole("link", { name: /Test World/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/world/save_1"));
  });

  it("imports a save JSON from the load page and enters it", async () => {
    const save = makeSave();
    apiMock.importSave.mockResolvedValue(save);
    const { router } = renderWithClient("load");
    const file = new File([JSON.stringify({ save })], "save.json", { type: "application/json" });

    await userEvent.upload(await screen.findByLabelText("Import save JSON"), file);

    await waitFor(() => expect(apiMock.importSave).toHaveBeenCalled());
    await waitFor(() => expect(router.state.location.pathname).toBe("/world/save_1"));
  });

  it("renders workbench editing controls for a selected save", async () => {
    const save = makeSave();
    const item: SaveListItem = {
      id: save.id,
      name: save.name,
      description: save.description,
      language: save.settings.language,
      turnNumber: save.turnNumber,
      characterCount: save.characters.length,
      updatedAt: save.updatedAt
    };
    apiMock.saves.mockResolvedValue([item]);
    apiMock.save.mockResolvedValue(save);

    renderWithClient();

    expect(await screen.findByRole("heading", { name: "Test World" })).toBeInTheDocument();
    await waitFor(() => expect(apiMock.save).toHaveBeenCalledWith("save_1"));
    expect(screen.getAllByText("World settings").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Save character" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Add relationship" }).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Save model").length).toBeGreaterThan(0);
  });

  it("saves a model override for the selected save", async () => {
    const save = makeSave();
    const item: SaveListItem = {
      id: save.id,
      name: save.name,
      description: save.description,
      language: save.settings.language,
      turnNumber: save.turnNumber,
      characterCount: save.characters.length,
      updatedAt: save.updatedAt
    };
    apiMock.saves.mockResolvedValue([item]);
    apiMock.save.mockResolvedValue(save);
    apiMock.updateSaveModelConfig.mockResolvedValue({
      ...save,
      modelConfig: {
        baseUrl: "https://save-model.example.test/v1",
        model: "save-model",
        hasApiKey: true,
        apiKeyTail: "alue"
      }
    });
    renderWithClient();

    expect(await screen.findByRole("heading", { name: "Test World" })).toBeInTheDocument();
    await userEvent.type(screen.getAllByLabelText("Save model base URL")[0]!, "https://save-model.example.test/v1");
    await userEvent.type(screen.getAllByLabelText("Save model")[0]!, "save-model");
    await userEvent.type(screen.getAllByLabelText("Save model API key")[0]!, "save-secret-api-key-value");
    await userEvent.type(screen.getAllByLabelText("Save model input token price")[0]!, "2");
    await userEvent.type(screen.getAllByLabelText("Save model output token price")[0]!, "8");
    await userEvent.click(screen.getAllByRole("button", { name: "Save model config" })[0]!);

    await waitFor(() =>
      expect(apiMock.updateSaveModelConfig).toHaveBeenCalledWith("save_1", {
        baseUrl: "https://save-model.example.test/v1",
        model: "save-model",
        apiKey: "save-secret-api-key-value",
        inputTokenPriceUsdPerMillion: 2,
        outputTokenPriceUsdPerMillion: 8
      })
    );
  });

  it("shows turn usage and estimated cost", async () => {
    const save = {
      ...makeSave(),
      turnNumber: 1,
      turns: [
        {
          id: "turn_1",
          saveId: "save_1",
          turnNumber: 1,
          status: "accepted" as const,
          events: [
            {
              id: "event_1",
              title: "Lantern signal",
              body: "The harbor sees the lantern change color.",
              involvedCharacterIds: ["character_1"],
              dialogue: []
            }
          ],
          stateChanges: [],
          callSummary: {
            model: "story-model",
            provider: "openai-compatible" as const,
            status: "succeeded" as const,
            calls: 1,
            durationMs: 1200,
            estimatedTokens: 400,
            inputTokens: 100,
            outputTokens: 300,
            totalTokens: 400,
            estimatedCostUsd: 0.0026
          },
          createdAt: "2026-06-17T00:00:00.000Z"
        }
      ]
    };
    const item: SaveListItem = {
      id: save.id,
      name: save.name,
      description: save.description,
      language: save.settings.language,
      turnNumber: save.turnNumber,
      characterCount: save.characters.length,
      updatedAt: save.updatedAt
    };
    apiMock.saves.mockResolvedValue([item]);
    apiMock.save.mockResolvedValue(save);
    renderWithClient();

    expect(await screen.findByText("Lantern signal")).toBeInTheDocument();
    expect(screen.getAllByText(/100 in \/ 300 out \/ 400 total tokens/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$0.002600/).length).toBeGreaterThan(0);
  });

  it("shows failed turn jobs with recovery controls", async () => {
    const save = makeSave();
    const item: SaveListItem = {
      id: save.id,
      name: save.name,
      description: save.description,
      language: save.settings.language,
      turnNumber: save.turnNumber,
      characterCount: save.characters.length,
      updatedAt: save.updatedAt
    };
    const failedJob = {
      id: "turn_job_failed",
      saveId: save.id,
      status: "failed" as const,
      phase: "validating_turn_references",
      input: {
        gmInstruction: "Break references",
        idempotencyKey: "turn_failed"
      },
      error: "Unknown focus character id: character_missing",
      failure: {
        code: "invalid_llm_reference",
        message: "Unknown focus character id: character_missing",
        phase: "validating_turn_references",
        retryable: true,
        createdAt: "2026-06-18T00:00:00.000Z",
        provider: "openai-compatible"
      }
    };

    apiMock.saves.mockResolvedValue([item]);
    apiMock.save.mockResolvedValue(save);
    apiMock.createTurn.mockResolvedValue(failedJob);
    renderWithClient();

    expect(await screen.findByRole("heading", { name: "Test World" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Advance turn" }));

    expect(await screen.findByText("Job failed")).toBeInTheDocument();
    expect(
      screen.getByText("invalid_llm_reference: Unknown focus character id: character_missing")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry job" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel job" })).toBeEnabled();
  });
});
