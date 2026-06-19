// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n.js";
import { SettingsPage } from "./SettingsPage.js";

const apiMock = vi.hoisted(() => ({
  health: vi.fn(),
  modelHealth: vi.fn(),
  modelConfig: vi.fn(),
  probeModelConfig: vi.fn(),
  runModelSmokeTest: vi.fn(),
  updateModelConfig: vi.fn()
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
      <SettingsPage />
    </QueryClientProvider>
  );
}

describe("SettingsPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
    apiMock.health.mockResolvedValue({
      ok: true,
      app: {
        status: "ok"
      }
    });
    apiMock.modelHealth.mockResolvedValue({
      status: "not_configured",
      hasApiKey: false,
      provider: "mock",
      model: "fantasy-model",
      recent: {
        windowSize: 50,
        calls: 0,
        failures: 0,
        errorRate: 0,
        averageLatencyMs: 0
      }
    });
    apiMock.modelConfig.mockResolvedValue({
      baseUrl: "https://api.example.test/v1",
      model: "fantasy-model",
      hasApiKey: true,
      apiKeyTail: "1234",
      supportsJsonMode: true,
      supportsUsage: true,
      supportsStream: false
    });
    apiMock.probeModelConfig.mockResolvedValue({
      ok: true,
      provider: "mock",
      latencyMs: 1,
      config: {
        baseUrl: "https://api.example.test/v1",
        model: "fantasy-model",
        hasApiKey: true,
        supportsJsonMode: true,
        supportsUsage: true,
        supportsStream: false
      }
    });
    apiMock.runModelSmokeTest.mockResolvedValue({
      ok: true,
      status: "skipped",
      provider: "mock",
      model: "fantasy-model",
      message: "No model API key is configured; live smoke test skipped."
    });
    apiMock.updateModelConfig.mockResolvedValue({
      baseUrl: "https://api.example.test/v1",
      model: "fantasy-model",
      hasApiKey: true,
      apiKeyTail: "1234",
      supportsJsonMode: true,
      supportsUsage: true,
      supportsStream: false
    });
  });

  it("probes and saves model settings", async () => {
    renderWithClient();

    expect(await screen.findByRole("heading", { name: "Model settings" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.example.test/v1"));

    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(apiMock.probeModelConfig).toHaveBeenCalled());
    expect(apiMock.updateModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://api.example.test/v1",
        model: "fantasy-model",
        supportsJsonMode: true,
        supportsUsage: true,
        supportsStream: false
      })
    );
    expect(await screen.findByText("Connection ok via mock: JSON yes, usage yes, stream no.")).toBeInTheDocument();
  });

  it("shows model health and runs a skipped smoke test without an API key", async () => {
    renderWithClient();

    expect(await screen.findByRole("heading", { name: "Health" })).toBeInTheDocument();
    expect(await screen.findByText("Status: not_configured")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Run smoke test" }));

    await waitFor(() => expect(apiMock.runModelSmokeTest).toHaveBeenCalled());
    expect(await screen.findByText("No model API key is configured; live smoke test skipped.")).toBeInTheDocument();
  });
});
