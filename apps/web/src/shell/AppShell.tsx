import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../api/client.js";
import { LoginPanel } from "./LoginPanel.js";

type AppShellProps = {
  nav: ReactNode;
  children: ReactNode;
};

export function AppShell({ nav, children }: AppShellProps) {
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: api.session });
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    }
  });

  if (session.isLoading) {
    return <div className="grid min-h-screen place-items-center text-sm text-slate-600">Loading FantasyWorld...</div>;
  }

  if (!session.data?.authenticated) {
    return <LoginPanel />;
  }

  return (
    <div className="min-h-screen bg-[#f6f3ec]">
      <header className="border-b border-slate-200 bg-white/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <div className="text-lg font-semibold text-slate-950">FantasyWorld</div>
            <div className="text-xs text-slate-500">AI world simulation workbench</div>
          </div>
          <nav className="flex items-center gap-4 text-sm font-medium text-slate-500">{nav}</nav>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50"
            type="button"
            onClick={() => logout.mutate()}
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
    </div>
  );
}
