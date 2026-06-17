// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n.js";
import { SettingsPage } from "./SettingsPage.js";

const apiMock = vi.hoisted(() => ({
  modelConfig: vi.fn(),
  probeModelConfig: vi.fn(),
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
});
