import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { type UiLanguage, uiLanguages } from "../i18n.js";
import { useUiStore } from "../state/ui.js";
import { LoginPanel } from "./LoginPanel.js";

type AppShellProps = {
  nav: ReactNode;
  children: ReactNode;
};

export function AppShell({ nav, children }: AppShellProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const uiLanguage = useUiStore((state) => state.uiLanguage);
  const setUiLanguage = useUiStore((state) => state.setUiLanguage);
  const session = useQuery({ queryKey: ["session"], queryFn: api.session });
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    }
  });

  if (session.isLoading) {
    return <div className="grid min-h-screen place-items-center text-sm text-slate-600">{t("nav.loading")}</div>;
  }

  if (!session.data?.authenticated) {
    return <LoginPanel />;
  }

  return (
    <div className="min-h-screen bg-[#f6f3ec]">
      <header className="sticky top-0 z-20 border-b border-white/50 bg-white/75 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-slate-950">FantasyWorld</div>
            <div className="text-xs text-slate-500">{t("nav.subtitle")}</div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <nav className="flex items-center gap-4 text-sm font-medium text-slate-500">{nav}</nav>
            {session.data.user ? (
              <div className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700">
                <UserRound size={16} />
                <span>{session.data.user.username}</span>
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
              {t("nav.uiLanguage")}
              <select
                aria-label={t("nav.uiLanguage")}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700"
                value={uiLanguage}
                onChange={(event) => setUiLanguage(event.target.value as UiLanguage)}
              >
                {uiLanguages.map((language) => (
                  <option key={language} value={language}>
                    {language === "zh" ? "中文" : "English"}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50"
              type="button"
              onClick={() => logout.mutate()}
            >
              <LogOut size={16} />
              {t("nav.logout")}
            </button>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
