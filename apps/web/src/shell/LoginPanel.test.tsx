// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n.js";
import { LoginPanel } from "./LoginPanel.js";

const apiMock = vi.hoisted(() => ({
  login: vi.fn()
}));

vi.mock("../api/client.js", () => ({
  api: apiMock
}));

function renderLoginPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LoginPanel />
    </QueryClientProvider>
  );
}

describe("LoginPanel", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    apiMock.login.mockResolvedValue({
      authenticated: true,
      user: {
        id: "user_alice",
        username: "alice",
        role: "player"
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("submits username and password", async () => {
    renderLoginPanel();
    const user = userEvent.setup();
    const username = screen.getByLabelText("Username");

    expect(username).toHaveValue("admin");
    await user.clear(username);
    await user.type(username, "alice");
    await user.click(screen.getByRole("button", { name: "Enter" }));

    await waitFor(() => expect(apiMock.login).toHaveBeenCalledWith("fantasyworld", "alice"));
  });
});
