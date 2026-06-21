import type { SaveImport } from "@fantasy-world/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileUp, Plus, Upload } from "lucide-react";
import { type ChangeEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";

export function LoadSavePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const saves = useQuery({ queryKey: ["saves"], queryFn: api.saves });
  const [importError, setImportError] = useState("");
  const importSave = useMutation({
    mutationFn: api.importSave,
    onSuccess: async (save) => {
      setImportError("");
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
      await navigate({ to: "/world/$saveId", params: { saveId: save.id } });
    },
    onError: (error) => setImportError(error.message)
  });

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as SaveImport;
      importSave.mutate(parsed);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t("world.invalidJson"));
    }
  };

  return (
    <section className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{t("load.kicker")}</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">{t("load.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{t("load.body")}</p>
        </div>
        <Link
          to="/create"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
        >
          <Plus size={16} />
          {t("title.createGame")}
        </Link>
      </div>

      <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <Upload size={16} />
          {importSave.isPending ? t("load.importing") : t("world.importJson")}
          <input
            aria-label={t("world.importSaveJson")}
            className="sr-only"
            type="file"
            accept="application/json"
            disabled={importSave.isPending}
            onChange={(event) => void handleImport(event)}
          />
        </label>
        {importError ? <p className="mt-3 text-sm text-red-600">{importError}</p> : null}
      </div>

      {saves.isLoading ? <div className="text-sm text-slate-500">{t("world.loadingSaves")}</div> : null}
      {saves.error ? <div className="text-sm text-red-600">{saves.error.message}</div> : null}

      {saves.data?.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {saves.data.map((save) => (
            <Link
              key={save.id}
              to="/world/$saveId"
              params={{ saveId: save.id }}
              className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-slate-300 hover:shadow"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-slate-950">{save.name}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {t("world.turnSummary", { turn: save.turnNumber, characters: save.characterCount })}
                  </p>
                </div>
                <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                  {save.language.toUpperCase()}
                </span>
              </div>
              <p className="mt-4 text-xs text-slate-500">{t("load.updatedAt", { date: save.updatedAt })}</p>
            </Link>
          ))}
        </div>
      ) : null}

      {saves.data && saves.data.length === 0 ? (
        <div className="grid min-h-80 place-items-center rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
          <div>
            <FileUp className="mx-auto text-slate-400" size={36} />
            <h2 className="mt-4 text-xl font-semibold text-slate-950">{t("load.emptyTitle")}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{t("load.emptyBody")}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
