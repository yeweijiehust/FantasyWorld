// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Save, SaveListItem } from "@fantasy-world/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n.js";
import { useUiStore } from "../state/ui.js";
import { WorldPage } from "./WorldPage.js";

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

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <WorldPage />
    </QueryClientProvider>
  );
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

describe("WorldPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
    useUiStore.setState({ selectedSaveId: undefined, uiLanguage: "en" });
    apiMock.saves.mockResolvedValue([]);
    apiMock.save.mockResolvedValue(makeSave());
  });

  it("renders the create wizard and keeps world language separate from UI language", async () => {
    renderWithClient();

    expect(await screen.findByText("New world")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("World language"), "en");

    expect(screen.getByRole("button", { name: /Age of Mist Harbor/ })).toBeInTheDocument();

    await i18n.changeLanguage("zh");

    expect(await screen.findByText("新世界")).toBeInTheDocument();
    expect(screen.getByLabelText("存档语言")).toHaveValue("en");
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
  });
});
