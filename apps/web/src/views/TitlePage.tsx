import { Link } from "@tanstack/react-router";
import { FolderOpen, Settings, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export function TitlePage() {
  const { t } = useTranslation();

  return (
    <section className="title-screen min-h-[calc(100vh-65px)] overflow-hidden">
      <div className="mx-auto flex min-h-[calc(100vh-65px)] max-w-7xl items-center px-4 py-12">
        <div className="max-w-xl text-white">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-200">{t("title.kicker")}</p>
          <h1 className="mt-3 text-5xl font-semibold leading-tight sm:text-7xl">FantasyWorld</h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-slate-100 sm:text-lg">{t("title.body")}</p>
          <div className="mt-8 grid max-w-sm gap-3">
            <Link
              to="/create"
              className="inline-flex h-12 items-center justify-center gap-3 rounded-md bg-amber-300 px-5 text-base font-semibold text-slate-950 shadow-lg shadow-black/20 hover:bg-amber-200"
            >
              <Sparkles size={20} />
              {t("title.createGame")}
            </Link>
            <Link
              to="/load"
              className="inline-flex h-11 items-center justify-center gap-3 rounded-md border border-white/40 bg-white/12 px-5 text-base font-semibold text-white backdrop-blur hover:bg-white/20"
            >
              <FolderOpen size={19} />
              {t("title.loadSave")}
            </Link>
            <Link
              to="/settings"
              className="inline-flex h-11 items-center justify-center gap-3 rounded-md border border-white/30 bg-black/20 px-5 text-base font-semibold text-white backdrop-blur hover:bg-black/30"
            >
              <Settings size={19} />
              {t("title.modelSettings")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
