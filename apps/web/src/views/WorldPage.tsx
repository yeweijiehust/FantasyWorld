import {
  WORLD_TEMPLATES,
  createTemplateSaveInput,
  type Character,
  type CreateSaveInput,
  type Language,
  type Location,
  type PatchTurnDraftInput,
  type Relationship,
  type Save,
  type SaveGenerationJob,
  type SaveImport,
  type StateChange,
  type TurnJob
} from "@fantasy-world/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  Download,
  Play,
  Plus,
  RotateCcw,
  Save as SaveIcon,
  Sparkles,
  Upload,
  Users
} from "lucide-react";
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { useUiStore } from "../state/ui.js";

const wizardSteps = [
  { id: "template", labelKey: "world.stepTemplate" },
  { id: "world", labelKey: "world.stepWorld" },
  { id: "cast", labelKey: "world.stepCast" },
  { id: "rules", labelKey: "world.stepRules" },
  { id: "draft", labelKey: "world.stepDraft" }
];
const defaultTemplateInput = createTemplateSaveInput("fantasy-frontier", "zh");
const generationJobStorageKey = "fantasyworld.currentGenerationJob";
const turnJobStorageKey = (saveId: string) => `fantasyworld.turnJob.${saveId}`;

type WizardValues = {
  templateId: string;
  language: Language;
  name: string;
  premise: string;
  turnTimeScale: string;
  randomness: number;
  contentBoundary: string;
  styleGuide: string;
  modelBaseUrl: string;
  modelName: string;
};

function toWizardValues(
  input: CreateSaveInput,
  previous?: Pick<WizardValues, "modelBaseUrl" | "modelName">
): WizardValues {
  return {
    templateId: input.templateId,
    language: input.settings.language,
    name: input.name,
    premise: input.premise,
    turnTimeScale: input.settings.turnTimeScale,
    randomness: input.settings.randomness,
    contentBoundary: input.settings.contentBoundary,
    styleGuide: input.settings.styleGuide,
    modelBaseUrl: previous?.modelBaseUrl ?? "",
    modelName: previous?.modelName ?? ""
  };
}

export function WorldPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const selectedSaveId = useUiStore((state) => state.selectedSaveId);
  const setSelectedSaveId = useUiStore((state) => state.setSelectedSaveId);
  const saves = useQuery({ queryKey: ["saves"], queryFn: api.saves });
  const save = useQuery({
    queryKey: ["save", selectedSaveId],
    queryFn: () => api.save(selectedSaveId ?? ""),
    enabled: Boolean(selectedSaveId)
  });

  useEffect(() => {
    if (!selectedSaveId && saves.data?.[0]) {
      setSelectedSaveId(saves.data[0].id);
    }
  }, [saves.data, selectedSaveId, setSelectedSaveId]);

  const activeSave = save.data;

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_340px]">
      <aside className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-950">{t("world.saves")}</h2>
          <span className="text-xs text-slate-500">{saves.data?.length ?? 0}</span>
        </div>
        <div className="grid gap-2">
          {saves.isLoading ? <div className="text-sm text-slate-500">{t("world.loadingSaves")}</div> : null}
          {saves.error ? <div className="text-sm text-red-600">{saves.error.message}</div> : null}
          {saves.data?.map((item) => (
            <button
              key={item.id}
              className={`rounded-md border px-3 py-2 text-left text-sm ${
                selectedSaveId === item.id
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              type="button"
              onClick={() => setSelectedSaveId(item.id)}
            >
              <div className="truncate font-medium">{item.name}</div>
              <div className={selectedSaveId === item.id ? "truncate text-slate-300" : "truncate text-slate-500"}>
                {t("world.turnSummary", { turn: item.turnNumber, characters: item.characterCount })}
              </div>
            </button>
          ))}
        </div>
        <CreateSavePanel
          onCreated={async (created) => {
            await queryClient.invalidateQueries({ queryKey: ["saves"] });
            setSelectedSaveId(created.id);
          }}
        />
      </aside>

      <section className="min-w-0 rounded-lg border border-slate-200 bg-white lg:min-h-[680px]">
        {save.error ? <div className="p-4 text-sm text-red-600">{save.error.message}</div> : null}
        {activeSave ? <Timeline key={activeSave.id} save={activeSave} /> : <EmptyWorld />}
      </section>

      {activeSave ? (
        <details className="rounded-lg border border-slate-200 bg-white p-4 lg:hidden">
          <summary className="cursor-pointer text-sm font-semibold text-slate-950">{t("world.mobileDetails")}</summary>
          <div className="mt-4">
            <WorldDetails save={activeSave} />
          </div>
        </details>
      ) : null}

      <aside className="hidden min-w-0 rounded-lg border border-slate-200 bg-white p-4 lg:block">
        {activeSave ? (
          <WorldDetails save={activeSave} />
        ) : (
          <div className="text-sm text-slate-500">{t("world.noWorldSelected")}</div>
        )}
      </aside>
    </div>
  );
}

function CreateSavePanel({ onCreated }: { onCreated: (save: Save) => Promise<void> }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(() => (localStorage.getItem(generationJobStorageKey) ? 4 : 0));
  const [values, setValues] = useState<WizardValues>(() => toWizardValues(defaultTemplateInput));
  const [seedText, setSeedText] = useState(defaultTemplateInput.characterSeeds.join("\n"));
  const [formError, setFormError] = useState("");
  const [generationJobId, setGenerationJobId] = useState(() => localStorage.getItem(generationJobStorageKey));
  const generationJob = useQuery({
    queryKey: ["generation-job", generationJobId],
    queryFn: () => api.generationJob(generationJobId ?? ""),
    enabled: Boolean(generationJobId)
  });
  const generation = useMutation({
    mutationFn: api.createGenerationJob,
    onSuccess: (job) => {
      localStorage.setItem(generationJobStorageKey, job.id);
      setGenerationJobId(job.id);
      queryClient.setQueryData(["generation-job", job.id], job);
      setStep(4);
    }
  });
  const [importError, setImportError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const accept = useMutation({
    mutationFn: (jobId: string) => api.acceptGenerationJob(jobId),
    onSuccess: async (save) => {
      const nextInput = createTemplateSaveInput(values.templateId, values.language);
      setValues(toWizardValues(nextInput, values));
      setSeedText(nextInput.characterSeeds.join("\n"));
      setStep(0);
      localStorage.removeItem(generationJobStorageKey);
      setGenerationJobId(null);
      generation.reset();
      await onCreated(save);
    }
  });
  const cancelGeneration = useMutation({
    mutationFn: (jobId: string) => api.cancelGenerationJob(jobId),
    onSuccess: (job) => {
      generation.reset();
      queryClient.setQueryData(["generation-job", job.id], job);
    }
  });
  const retryGeneration = useMutation({
    mutationFn: (jobId: string) => api.retryGenerationJob(jobId),
    onSuccess: (job) => {
      generation.reset();
      queryClient.setQueryData(["generation-job", job.id], job);
    }
  });
  const importSave = useMutation({
    mutationFn: api.importSave,
    onSuccess: async (save) => {
      setImportError("");
      setImportMessage(t("world.imported"));
      await onCreated(save);
    },
    onError: (error) => {
      setImportMessage("");
      setImportError(error.message);
    }
  });
  const selectedTemplate = WORLD_TEMPLATES.find((template) => template.id === values.templateId) ?? WORLD_TEMPLATES[0];
  const currentGenerationJob = generation.data ?? generationJob.data;
  const characterSeeds = seedText
    .split("\n")
    .map((seed) => seed.trim())
    .filter(Boolean);

  useEffect(() => {
    if (!generationJobId) {
      return;
    }

    const source = new EventSource(`/api/save-generation-jobs/${generationJobId}/events`, { withCredentials: true });
    const updateJob = (event: MessageEvent<string>) => {
      const job = JSON.parse(event.data) as SaveGenerationJob;
      queryClient.setQueryData(["generation-job", job.id], job);
    };

    source.addEventListener("snapshot", updateJob);
    source.addEventListener("final", updateJob);
    source.onerror = () => {
      source.close();
      void queryClient.invalidateQueries({ queryKey: ["generation-job", generationJobId] });
    };

    return () => source.close();
  }, [generationJobId, queryClient]);

  const updateValue = <Key extends keyof WizardValues>(key: Key, value: WizardValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFormError("");
  };
  const applyTemplate = (templateId: string, language = values.language) => {
    const nextInput = createTemplateSaveInput(templateId, language);

    setValues(toWizardValues(nextInput, values));
    setSeedText(nextInput.characterSeeds.join("\n"));
    setFormError("");
    generation.reset();
  };
  const buildInput = (): CreateSaveInput | undefined => {
    if (!values.name.trim() || !values.premise.trim()) {
      setStep(1);
      setFormError(t("world.requiredWorld"));
      return undefined;
    }

    if (characterSeeds.length < 3 || characterSeeds.length > 8) {
      setStep(2);
      setFormError(t("world.requiredCast"));
      return undefined;
    }

    const input: CreateSaveInput = {
      templateId: values.templateId,
      name: values.name.trim(),
      premise: values.premise.trim(),
      characterSeeds,
      idempotencyKey: crypto.randomUUID(),
      settings: {
        language: values.language,
        turnTimeScale: values.turnTimeScale.trim(),
        randomness: values.randomness,
        contentBoundary: values.contentBoundary.trim(),
        styleGuide: values.styleGuide.trim()
      }
    };
    const baseUrl = values.modelBaseUrl.trim();
    const model = values.modelName.trim();

    if (baseUrl || model) {
      input.modelOverride = {
        ...(baseUrl ? { baseUrl } : {}),
        ...(model ? { model } : {})
      };
    }

    return input;
  };
  const generateDraft = () => {
    const input = buildInput();

    if (!input) {
      return;
    }

    setFormError("");
    generation.mutate(input);
  };
  const handleLanguageChange = (language: Language) => {
    applyTemplate(values.templateId, language);
  };
  const nextStep = () => {
    if (step === 1 && (!values.name.trim() || !values.premise.trim())) {
      setFormError(t("world.requiredWorld"));
      return;
    }

    if (step === 2 && (characterSeeds.length < 3 || characterSeeds.length > 8)) {
      setFormError(t("world.requiredCast"));
      return;
    }

    setFormError("");
    setStep((current) => Math.min(current + 1, wizardSteps.length - 1));
  };
  const resetDraft = () => {
    generation.reset();
    localStorage.removeItem(generationJobStorageKey);
    setGenerationJobId(null);
    setStep(0);
  };
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
      setImportMessage("");
      setImportError(error instanceof Error ? error.message : t("world.invalidJson"));
    }
  };

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
        <Plus size={16} />
        {t("world.createHeading")}
      </div>
      <div className="grid grid-cols-5 gap-1" aria-label={t("world.createSteps")}>
        {wizardSteps.map((item, index) => (
          <button
            key={item.id}
            className={`h-8 rounded-md text-[11px] font-medium ${
              step === index ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
            type="button"
            onClick={() => setStep(index)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 text-sm">
        {step === 0 ? (
          <div className="grid gap-3">
            <label className="grid gap-2 font-medium text-slate-700">
              {t("world.worldLanguage")}
              <select
                aria-label={t("world.worldLanguage")}
                className="h-9 rounded-md border border-slate-300 px-3"
                value={values.language}
                onChange={(event) => handleLanguageChange(event.target.value as Language)}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <div className="grid gap-2">
              {WORLD_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  className={`rounded-md border px-3 py-2 text-left ${
                    values.templateId === template.id
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  type="button"
                  onClick={() => applyTemplate(template.id)}
                >
                  <div className="font-semibold">{template.name[values.language]}</div>
                  <div className={values.templateId === template.id ? "text-slate-300" : "text-slate-500"}>
                    {template.genre[values.language]}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {step === 1 ? (
          <div className="grid gap-3">
            <label className="grid gap-2 font-medium text-slate-700">
              {t("world.worldName")}
              <input
                aria-label={t("world.worldName")}
                className="h-9 rounded-md border border-slate-300 px-3"
                value={values.name}
                onChange={(event) => updateValue("name", event.target.value)}
              />
            </label>
            <label className="grid gap-2 font-medium text-slate-700">
              {t("world.premise")}
              <textarea
                aria-label={t("world.premise")}
                className="min-h-24 rounded-md border border-slate-300 px-3 py-2"
                value={values.premise}
                onChange={(event) => updateValue("premise", event.target.value)}
              />
            </label>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="grid gap-3">
            <label className="grid gap-2 font-medium text-slate-700">
              {t("world.characterSeeds")}
              <textarea
                aria-label={t("world.characterSeeds")}
                className="min-h-28 rounded-md border border-slate-300 px-3 py-2"
                value={seedText}
                onChange={(event) => {
                  setSeedText(event.target.value);
                  setFormError("");
                }}
              />
            </label>
            <div className={characterSeeds.length < 3 || characterSeeds.length > 8 ? "text-red-600" : "text-slate-500"}>
              {t("world.characterCount", { count: characterSeeds.length })}
            </div>
          </div>
        ) : null}
        {step === 3 ? (
          <div className="grid gap-3">
            <label className="grid gap-2 font-medium text-slate-700">
              {t("world.contentBoundary")}
              <input
                aria-label={t("world.contentBoundary")}
                className="h-9 rounded-md border border-slate-300 px-3"
                value={values.contentBoundary}
                onChange={(event) => updateValue("contentBoundary", event.target.value)}
              />
            </label>
            <label className="grid gap-2 font-medium text-slate-700">
              {t("world.turnScale")}
              <input
                aria-label={t("world.turnScale")}
                className="h-9 rounded-md border border-slate-300 px-3"
                value={values.turnTimeScale}
                onChange={(event) => updateValue("turnTimeScale", event.target.value)}
              />
            </label>
            <label className="grid gap-2 font-medium text-slate-700">
              {t("world.randomness")}
              <input
                aria-label={t("world.randomness")}
                className="h-9 rounded-md border border-slate-300 px-3"
                type="number"
                min={0}
                max={100}
                value={values.randomness}
                onChange={(event) => updateValue("randomness", Number(event.target.value))}
              />
            </label>
            <label className="grid gap-2 font-medium text-slate-700">
              {t("world.styleGuide")}
              <textarea
                aria-label={t("world.styleGuide")}
                className="min-h-20 rounded-md border border-slate-300 px-3 py-2"
                value={values.styleGuide}
                onChange={(event) => updateValue("styleGuide", event.target.value)}
              />
            </label>
            <label className="grid gap-2 font-medium text-slate-700">
              {t("world.modelBaseUrl")}
              <input
                aria-label={t("world.modelBaseUrl")}
                className="h-9 rounded-md border border-slate-300 px-3"
                value={values.modelBaseUrl}
                onChange={(event) => updateValue("modelBaseUrl", event.target.value)}
              />
            </label>
            <label className="grid gap-2 font-medium text-slate-700">
              {t("world.model")}
              <input
                aria-label={t("world.modelOverride")}
                className="h-9 rounded-md border border-slate-300 px-3"
                value={values.modelName}
                onChange={(event) => updateValue("modelName", event.target.value)}
              />
            </label>
          </div>
        ) : null}
        {step === 4 ? (
          <div className="grid gap-3">
            <div className="rounded-md bg-slate-50 p-3 text-slate-600">
              {selectedTemplate.name[values.language]} · {characterSeeds.length} characters
            </div>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 font-semibold text-white disabled:opacity-60"
              type="button"
              disabled={generation.isPending}
              onClick={generateDraft}
            >
              <Sparkles size={16} />
              {t("world.generateDraft")}
            </button>
            {currentGenerationJob?.draft ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
                <div className="font-semibold">{t("world.draftReady")}</div>
                <div className="mt-1 text-emerald-800">
                  {currentGenerationJob.draft.save.characters.length} characters ·{" "}
                  {currentGenerationJob.draft.save.locations[0]?.name}
                </div>
                <div className="mt-2 text-xs text-emerald-800">
                  {currentGenerationJob.draft.save.worldMemory.worldSummary}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {currentGenerationJob.draft.save.characters.map((character) => (
                    <span key={character.id} className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-900">
                      {character.name}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="h-8 rounded-md bg-emerald-700 px-3 text-white disabled:opacity-60"
                    type="button"
                    disabled={
                      accept.isPending ||
                      currentGenerationJob.status === "cancelled" ||
                      currentGenerationJob.status === "failed"
                    }
                    onClick={() => accept.mutate(currentGenerationJob.id)}
                  >
                    {t("world.acceptDraft")}
                  </button>
                  <button
                    className="h-8 rounded-md bg-white px-3 text-emerald-800 disabled:opacity-60"
                    type="button"
                    disabled={cancelGeneration.isPending || currentGenerationJob.status !== "needs_review"}
                    onClick={() => cancelGeneration.mutate(currentGenerationJob.id)}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    className="h-8 rounded-md bg-white px-3 text-emerald-800 disabled:opacity-60"
                    type="button"
                    disabled={retryGeneration.isPending || currentGenerationJob.status === "needs_review"}
                    onClick={() => retryGeneration.mutate(currentGenerationJob.id)}
                  >
                    {t("common.retry")}
                  </button>
                  <button className="h-8 rounded-md bg-white px-3 text-emerald-800" type="button" onClick={resetDraft}>
                    {t("common.revise")}
                  </button>
                </div>
              </div>
            ) : null}
            {currentGenerationJob?.status === "failed" ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
                <div className="font-semibold">{t("world.generationFailed")}</div>
                {currentGenerationJob.failure ? (
                  <div className="mt-1 text-sm text-red-800">
                    {t("world.failureReason", {
                      code: currentGenerationJob.failure.code,
                      message: currentGenerationJob.failure.message
                    })}
                  </div>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <button
                    className="h-8 rounded-md bg-white px-3 text-red-800 disabled:opacity-60"
                    type="button"
                    disabled={retryGeneration.isPending}
                    onClick={() => retryGeneration.mutate(currentGenerationJob.id)}
                  >
                    {t("common.retry")}
                  </button>
                  <button
                    className="h-8 rounded-md bg-white px-3 text-red-800 disabled:opacity-60"
                    type="button"
                    disabled={cancelGeneration.isPending}
                    onClick={() => cancelGeneration.mutate(currentGenerationJob.id)}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-between gap-2">
          <button
            className="h-8 rounded-md border border-slate-300 px-3 text-slate-700 disabled:opacity-50"
            type="button"
            disabled={step === 0}
            onClick={() => setStep((current) => Math.max(current - 1, 0))}
          >
            {t("common.back")}
          </button>
          {step < wizardSteps.length - 1 ? (
            <button className="h-8 rounded-md bg-slate-950 px-3 text-white" type="button" onClick={nextStep}>
              {t("common.next")}
            </button>
          ) : null}
        </div>
      </div>
      {formError ? <p className="mt-2 text-sm text-red-600">{formError}</p> : null}
      {generation.error ? <p className="mt-2 text-sm text-red-600">{generation.error.message}</p> : null}
      {accept.error ? <p className="mt-2 text-sm text-red-600">{accept.error.message}</p> : null}
      {cancelGeneration.error ? <p className="mt-2 text-sm text-red-600">{cancelGeneration.error.message}</p> : null}
      {retryGeneration.error ? <p className="mt-2 text-sm text-red-600">{retryGeneration.error.message}</p> : null}
      <label className="mt-3 grid gap-2 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-2">
          <Upload size={14} />
          {t("world.importJson")}
        </span>
        <input
          aria-label={t("world.importSaveJson")}
          className="block w-full text-xs file:mr-3 file:h-8 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:text-slate-700"
          type="file"
          accept="application/json"
          disabled={importSave.isPending}
          onChange={(event) => void handleImport(event)}
        />
      </label>
      {importMessage ? <p className="mt-2 text-sm text-emerald-700">{importMessage}</p> : null}
      {importError ? <p className="mt-2 text-sm text-red-600">{importError}</p> : null}
    </div>
  );
}
function Timeline({ save }: { save: Save }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [instruction, setInstruction] = useState("");
  const [turnJobId, setTurnJobId] = useState(() => localStorage.getItem(turnJobStorageKey(save.id)));
  const turnJob = useQuery({
    queryKey: ["turn-job", turnJobId],
    queryFn: () => api.turnJob(turnJobId ?? ""),
    enabled: Boolean(turnJobId)
  });
  const refreshSave = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
    await queryClient.invalidateQueries({ queryKey: ["saves"] });
  }, [queryClient, save.id]);
  const turn = useMutation({
    mutationFn: () => api.createTurn(save.id, { gmInstruction: instruction, idempotencyKey: crypto.randomUUID() }),
    onSuccess: async (job) => {
      setInstruction("");
      localStorage.setItem(turnJobStorageKey(save.id), job.id);
      setTurnJobId(job.id);
      queryClient.setQueryData(["turn-job", job.id], job);
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });
  const activeTurnJob = turnJob.data ?? turn.data;
  const activeTurnJobIsOpen =
    activeTurnJob?.status === "queued" ||
    activeTurnJob?.status === "running" ||
    activeTurnJob?.status === "needs_review";
  const draftTurn = activeTurnJob?.status === "needs_review" ? activeTurnJob.turn : undefined;
  const displayedTurns =
    draftTurn && !save.turns.some((turnItem) => turnItem.id === draftTurn.id) ? [...save.turns, draftTurn] : save.turns;
  const latestTurn = draftTurn ?? save.turns.at(-1);
  const latestUsageSummary = latestTurn ? formatTurnUsage(latestTurn.callSummary, t) : undefined;
  const rollback = useMutation({
    mutationFn: () => api.rollbackSave(save.id),
    onSuccess: refreshSave
  });
  const acceptTurn = useMutation({
    mutationFn: () => {
      if (!latestTurn) {
        throw new Error("No turn to accept");
      }

      return api.acceptTurn(latestTurn.id);
    },
    onSuccess: async () => {
      localStorage.removeItem(turnJobStorageKey(save.id));
      setTurnJobId(null);
      turn.reset();
      await refreshSave();
    }
  });
  const cancelTurn = useMutation({
    mutationFn: (jobId: string) => api.cancelTurnJob(jobId),
    onSuccess: async (job) => {
      queryClient.setQueryData(["turn-job", job.id], job);
      localStorage.removeItem(turnJobStorageKey(save.id));
      setTurnJobId(null);
      turn.reset();
      await refreshSave();
    }
  });
  const retryTurn = useMutation({
    mutationFn: (jobId: string) => api.retryTurnJob(jobId),
    onSuccess: async (job) => {
      localStorage.setItem(turnJobStorageKey(save.id), job.id);
      setTurnJobId(job.id);
      turn.reset();
      queryClient.setQueryData(["turn-job", job.id], job);
      await refreshSave();
    }
  });
  const exportSave = useMutation({
    mutationFn: () => api.exportSave(save.id),
    onSuccess: (payload) => downloadJson(`${save.name}.fantasyworld.json`, payload)
  });

  useEffect(() => {
    if (!turnJobId) {
      return;
    }

    const source = new EventSource(`/api/turn-jobs/${turnJobId}/events`, { withCredentials: true });
    const updateJob = (event: MessageEvent<string>) => {
      const job = JSON.parse(event.data) as TurnJob;
      queryClient.setQueryData(["turn-job", job.id], job);

      if (job.status === "needs_review" || job.status === "cancelled" || job.status === "accepted") {
        void refreshSave();
      }
    };

    source.addEventListener("snapshot", updateJob);
    source.addEventListener("final", updateJob);
    source.onerror = () => {
      source.close();
      void queryClient.invalidateQueries({ queryKey: ["turn-job", turnJobId] });
    };

    return () => source.close();
  }, [turnJobId, queryClient, refreshSave]);

  return (
    <div className="flex min-h-[680px] flex-col">
      <div className="border-b border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">{save.name}</h1>
            <p className="mt-1 text-sm text-slate-500">{save.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 text-sm text-slate-600">
              <Clock3 size={16} />
              {t("world.turnSummary", { turn: save.turnNumber, characters: save.characters.length })} ·{" "}
              {save.settings.turnTimeScale}
            </div>
            <button
              className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              type="button"
              disabled={exportSave.isPending}
              onClick={() => exportSave.mutate()}
            >
              <Download size={14} />
              {t("world.export")}
            </button>
            {save.turnNumber > 0 ? (
              <button
                className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                type="button"
                disabled={rollback.isPending}
                onClick={() => rollback.mutate()}
              >
                <RotateCcw size={14} />
                {t("world.rollback")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex-1 p-4">
        {displayedTurns.length === 0 ? (
          <div className="grid min-h-72 place-items-center rounded-lg border border-dashed border-slate-300 text-center">
            <div>
              <BookOpen className="mx-auto mb-3 text-slate-400" />
              <div className="font-medium text-slate-800">{t("world.firstTurnTitle")}</div>
              <div className="mt-1 text-sm text-slate-500">{t("world.firstTurnBody")}</div>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {displayedTurns.map((turnItem) => (
              <article key={turnItem.id} className="rounded-lg border border-slate-200 p-4">
                <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <span>
                    {t("world.turnSummary", { turn: turnItem.turnNumber, characters: save.characters.length })}
                  </span>
                  {turnItem.status === "needs_review" ? (
                    <span className="rounded bg-amber-50 px-2 py-1 text-amber-700">{t("world.draft")}</span>
                  ) : null}
                </div>
                {turnItem.events.map((event) => (
                  <div key={event.id}>
                    <h2 className="text-lg font-semibold text-slate-950">{event.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-700">{event.body}</p>
                    {event.dialogue?.length ? (
                      <div className="mt-3 grid gap-2">
                        {event.dialogue.map((line) => (
                          <blockquote
                            key={`${event.id}:${line.characterId}:${line.line}`}
                            className="border-l-2 border-slate-300 pl-3 text-sm text-slate-600"
                          >
                            {line.line}
                          </blockquote>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                <div className="mt-3 text-xs text-slate-500">{formatTurnUsage(turnItem.callSummary, t)}</div>
              </article>
            ))}
          </div>
        )}
      </div>
      {activeTurnJob?.status === "needs_review" && activeTurnJob.turn && activeTurnJob.draftState ? (
        <TurnDraftEditor key={`${activeTurnJob.id}:${activeTurnJob.turn.id}`} job={activeTurnJob} save={save} />
      ) : null}
      <div className="border-t border-slate-200 p-4">
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          {t("world.gmIntervention")}
          <textarea
            aria-label={t("world.gmIntervention")}
            className="min-h-20 rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none focus:border-slate-950"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={t("world.gmPlaceholder")}
          />
        </label>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
              type="button"
              disabled={turn.isPending || activeTurnJobIsOpen}
              onClick={() => turn.mutate()}
            >
              <Play size={16} />
              {turn.isPending ? t("world.advancing") : t("world.advanceTurn")}
            </button>
            {latestTurn ? (
              <button
                className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-200 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                type="button"
                disabled={latestTurn.status === "accepted" || acceptTurn.isPending}
                onClick={() => acceptTurn.mutate()}
              >
                <CheckCircle2 size={16} />
                {latestTurn.status === "accepted" ? t("world.turnAccepted") : t("world.acceptTurn")}
              </button>
            ) : null}
            {activeTurnJob ? (
              <>
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  type="button"
                  disabled={
                    cancelTurn.isPending || activeTurnJob.status === "cancelled" || activeTurnJob.status === "accepted"
                  }
                  onClick={() => cancelTurn.mutate(activeTurnJob.id)}
                >
                  {t("world.cancelJob")}
                </button>
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  type="button"
                  disabled={retryTurn.isPending || activeTurnJobIsOpen || activeTurnJob.status === "accepted"}
                  onClick={() => retryTurn.mutate(activeTurnJob.id)}
                >
                  {t("world.retryJob")}
                </button>
              </>
            ) : null}
          </div>
          <div className="text-xs text-slate-500">
            {activeTurnJob
              ? `Job ${activeTurnJob.status}${activeTurnJob.phase ? ` · ${activeTurnJob.phase}` : ""}`
              : latestTurn
                ? latestUsageSummary
                : t("world.mockReady")}
          </div>
        </div>
        {activeTurnJob?.status === "failed" ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <div className="font-semibold">{t("world.jobFailed")}</div>
            {activeTurnJob.failure ? (
              <div className="mt-1 text-red-800">
                {t("world.failureReason", {
                  code: activeTurnJob.failure.code,
                  message: activeTurnJob.failure.message
                })}
              </div>
            ) : null}
          </div>
        ) : null}
        {turn.error ? <p className="mt-2 text-sm text-red-600">{turn.error.message}</p> : null}
        {rollback.error ? <p className="mt-2 text-sm text-red-600">{rollback.error.message}</p> : null}
        {acceptTurn.error ? <p className="mt-2 text-sm text-red-600">{acceptTurn.error.message}</p> : null}
        {cancelTurn.error ? <p className="mt-2 text-sm text-red-600">{cancelTurn.error.message}</p> : null}
        {retryTurn.error ? <p className="mt-2 text-sm text-red-600">{retryTurn.error.message}</p> : null}
        {exportSave.error ? <p className="mt-2 text-sm text-red-600">{exportSave.error.message}</p> : null}
      </div>
    </div>
  );
}

function TurnDraftEditor({ job, save }: { job: TurnJob; save: Save }) {
  const queryClient = useQueryClient();
  const event = job.turn?.events[0];
  const [title, setTitle] = useState(event?.title ?? "");
  const [body, setBody] = useState(event?.body ?? "");
  const [stateChanges, setStateChanges] = useState<StateChange[]>(job.turn?.stateChanges ?? []);
  const [characterUpdates, setCharacterUpdates] = useState(job.draftState?.characterUpdates ?? []);
  const [relationshipUpdates, setRelationshipUpdates] = useState(job.draftState?.relationshipUpdates ?? []);
  const characterNames = useMemo(
    () => new Map(save.characters.map((character) => [character.id, character.name])),
    [save.characters]
  );
  const relationshipNames = useMemo(
    () => new Map(save.relationships.map((relationship) => [relationship.id, relationship.label])),
    [save.relationships]
  );
  const patch = useMutation({
    mutationFn: () => {
      const payload: PatchTurnDraftInput = {
        event: { title, body },
        stateChanges,
        characterUpdates,
        relationshipUpdates
      };

      return api.patchTurnDraft(job.id, payload);
    },
    onSuccess: (patched) => {
      queryClient.setQueryData(["turn-job", patched.id], patched);
    }
  });

  const updateStateChange = (index: number, patchValue: Partial<StateChange>) => {
    setStateChanges((current) =>
      current.map((change, changeIndex) => (changeIndex === index ? { ...change, ...patchValue } : change))
    );
  };
  const updateCharacter = (characterId: string, patchValue: (typeof characterUpdates)[number]) => {
    setCharacterUpdates((current) =>
      current.map((update) => (update.characterId === characterId ? { ...update, ...patchValue } : update))
    );
  };
  const updateRelationship = (relationshipId: string, patchValue: (typeof relationshipUpdates)[number]) => {
    setRelationshipUpdates((current) =>
      current.map((update) => (update.relationshipId === relationshipId ? { ...update, ...patchValue } : update))
    );
  };

  return (
    <section className="border-t border-amber-200 bg-amber-50/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">Turn draft review</h2>
        </div>
        <button
          className="inline-flex h-8 items-center gap-2 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-60"
          type="button"
          disabled={patch.isPending}
          onClick={() => patch.mutate()}
        >
          <SaveIcon size={14} />
          {patch.isPending ? "Saving..." : "Save draft"}
        </button>
      </div>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Event title
            <input
              aria-label="Draft event title"
              className="h-9 rounded-md border border-slate-300 px-3 text-sm text-slate-950"
              value={title}
              onChange={(item) => setTitle(item.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Event body
            <textarea
              aria-label="Draft event body"
              className="min-h-24 rounded-md border border-slate-300 px-3 py-2 text-sm leading-6 text-slate-950"
              value={body}
              onChange={(item) => setBody(item.target.value)}
            />
          </label>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">State changes</div>
          <div className="grid gap-2">
            {stateChanges.map((change, index) => (
              <div key={change.id} className="grid gap-2 rounded-md border border-amber-200 bg-white p-3">
                <div className="text-xs font-medium text-slate-700">
                  {change.targetType}.{change.field}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    aria-label={`State change ${index + 1} field`}
                    className="h-8 rounded-md border border-slate-300 px-2 text-xs text-slate-950"
                    value={change.field}
                    onChange={(item) => updateStateChange(index, { field: item.target.value })}
                  />
                  <input
                    aria-label={`State change ${index + 1} before`}
                    className="h-8 rounded-md border border-slate-300 px-2 text-xs text-slate-950"
                    value={change.before}
                    onChange={(item) => updateStateChange(index, { before: item.target.value })}
                  />
                  <input
                    aria-label={`State change ${index + 1} after`}
                    className="h-8 rounded-md border border-slate-300 px-2 text-xs text-slate-950"
                    value={change.after}
                    onChange={(item) => updateStateChange(index, { after: item.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {characterUpdates.map((update) => (
            <div key={update.characterId} className="grid gap-2 rounded-md border border-amber-200 bg-white p-3">
              <div className="text-sm font-semibold text-slate-900">
                {characterNames.get(update.characterId) ?? update.characterId}
              </div>
              <label className="grid gap-1 text-xs font-medium text-slate-600">
                Short-term goal
                <input
                  aria-label={`Short-term goal ${update.characterId}`}
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs text-slate-950"
                  value={update.shortTermGoal ?? ""}
                  onChange={(item) =>
                    updateCharacter(update.characterId, { ...update, shortTermGoal: item.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-slate-600">
                Long-term goal
                <input
                  aria-label={`Long-term goal ${update.characterId}`}
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs text-slate-950"
                  value={update.longTermGoal ?? ""}
                  onChange={(item) =>
                    updateCharacter(update.characterId, { ...update, longTermGoal: item.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-slate-600">
                Private memory
                <textarea
                  aria-label={`Private memory ${update.characterId}`}
                  className="min-h-24 rounded-md border border-slate-300 px-2 py-2 text-xs leading-5 text-slate-950"
                  value={(update.privateMemory ?? []).join("\n")}
                  onChange={(item) =>
                    updateCharacter(update.characterId, {
                      ...update,
                      privateMemory: item.target.value.split("\n").filter(Boolean)
                    })
                  }
                />
              </label>
            </div>
          ))}
          {relationshipUpdates.map((update) => (
            <div key={update.relationshipId} className="grid gap-2 rounded-md border border-amber-200 bg-white p-3">
              <div className="text-sm font-semibold text-slate-900">
                {relationshipNames.get(update.relationshipId) ?? update.relationshipId}
              </div>
              <label className="grid gap-1 text-xs font-medium text-slate-600">
                Strength
                <input
                  aria-label={`Relationship strength ${update.relationshipId}`}
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs text-slate-950"
                  type="number"
                  min={-100}
                  max={100}
                  value={update.strength ?? 0}
                  onChange={(item) =>
                    updateRelationship(update.relationshipId, { ...update, strength: Number(item.target.value) })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-slate-600">
                Summary
                <textarea
                  aria-label={`Relationship summary ${update.relationshipId}`}
                  className="min-h-24 rounded-md border border-slate-300 px-2 py-2 text-xs leading-5 text-slate-950"
                  value={update.summary ?? ""}
                  onChange={(item) =>
                    updateRelationship(update.relationshipId, { ...update, summary: item.target.value })
                  }
                />
              </label>
            </div>
          ))}
        </div>
      </div>
      {patch.error ? <p className="mt-2 text-sm text-red-600">{patch.error.message}</p> : null}
    </section>
  );
}

function WorldDetails({ save }: { save: Save }) {
  const latestTurn = save.turns.at(-1);

  return (
    <div className="grid gap-5">
      <WorldSettingsEditor key={`${save.id}:${JSON.stringify(save.settings)}`} save={save} />
      <WorldMemoryEditor key={`${save.id}:${save.worldMemory.worldSummary}`} save={save} />
      <section>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-950">
          <Users size={16} />
          Characters
        </div>
        <div className="grid gap-2">
          {save.characters.map((character) => (
            <CharacterCard
              key={`${character.id}:${character.name}:${character.shortTermGoal}:${character.privateMemory.join("|")}`}
              saveId={save.id}
              locations={save.locations}
              character={character}
            />
          ))}
          <AddCharacterForm key={`${save.id}:${save.locations.map((location) => location.id).join("|")}`} save={save} />
        </div>
      </section>
      <section>
        <div className="mb-2 text-sm font-semibold text-slate-950">Locations</div>
        <div className="grid gap-2">
          {save.locations.map((location) => (
            <LocationCard key={`${location.id}:${location.name}:${location.status}`} save={save} location={location} />
          ))}
          <AddLocationForm saveId={save.id} />
        </div>
      </section>
      <section>
        <div className="mb-2 text-sm font-semibold text-slate-950">Relationships</div>
        <div className="grid gap-2">
          {save.relationships.map((relationship) => (
            <RelationshipCard
              key={`${relationship.id}:${relationship.label}:${relationship.strength}`}
              save={save}
              relationship={relationship}
            />
          ))}
          <AddRelationshipForm
            key={`${save.id}:${save.characters.map((character) => character.id).join("|")}`}
            save={save}
          />
        </div>
      </section>
      <section>
        <div className="mb-2 text-sm font-semibold text-slate-950">Latest state changes</div>
        {latestTurn ? (
          <div className="grid gap-2">
            {latestTurn.stateChanges.map((change) => (
              <div key={change.id} className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                {change.targetType}.{change.field}: {change.before} {"->"} {change.after}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">No turn accepted yet.</div>
        )}
      </section>
    </div>
  );
}

function WorldMemoryEditor({ save }: { save: Save }) {
  const queryClient = useQueryClient();
  const [worldSummary, setWorldSummary] = useState(save.worldMemory.worldSummary);
  const memory = useMutation({
    mutationFn: () => api.patchSave(save.id, { worldMemory: { ...save.worldMemory, worldSummary } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });

  return (
    <section>
      <div className="mb-2 text-sm font-semibold text-slate-950">World memory</div>
      <textarea
        aria-label="World summary"
        className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-6 text-slate-950"
        value={worldSummary}
        onChange={(event) => setWorldSummary(event.target.value)}
      />
      <button
        className="mt-2 inline-flex h-8 items-center gap-2 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-60"
        type="button"
        disabled={memory.isPending}
        onClick={() => memory.mutate()}
      >
        <SaveIcon size={14} />
        Save memory
      </button>
      {memory.error ? <p className="mt-2 text-sm text-red-600">{memory.error.message}</p> : null}
    </section>
  );
}

function WorldSettingsEditor({ save }: { save: Save }) {
  const queryClient = useQueryClient();
  const [turnTimeScale, setTurnTimeScale] = useState(save.settings.turnTimeScale);
  const [randomness, setRandomness] = useState(save.settings.randomness);
  const [contentBoundary, setContentBoundary] = useState(save.settings.contentBoundary);
  const [styleGuide, setStyleGuide] = useState(save.settings.styleGuide);
  const [modelBaseUrl, setModelBaseUrl] = useState(save.modelConfig?.baseUrl ?? "");
  const [modelName, setModelName] = useState(save.modelConfig?.model ?? "");
  const [modelApiKey, setModelApiKey] = useState("");
  const [inputTokenPrice, setInputTokenPrice] = useState(
    save.modelConfig?.inputTokenPriceUsdPerMillion?.toString() ?? ""
  );
  const [outputTokenPrice, setOutputTokenPrice] = useState(
    save.modelConfig?.outputTokenPriceUsdPerMillion?.toString() ?? ""
  );
  const settings = useMutation({
    mutationFn: () =>
      api.patchSave(save.id, {
        settings: {
          ...save.settings,
          turnTimeScale,
          randomness,
          contentBoundary,
          styleGuide
        }
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });
  const saveModel = useMutation({
    mutationFn: () => {
      const payload: Parameters<typeof api.updateSaveModelConfig>[1] = {};
      const baseUrl = modelBaseUrl.trim();
      const model = modelName.trim();
      const apiKey = modelApiKey.trim();
      const parsedInputPrice = parseOptionalPrice(inputTokenPrice);
      const parsedOutputPrice = parseOptionalPrice(outputTokenPrice);

      if (baseUrl) {
        payload.baseUrl = baseUrl;
      }

      if (model) {
        payload.model = model;
      }

      if (apiKey) {
        payload.apiKey = apiKey;
      }

      if (parsedInputPrice !== undefined) {
        payload.inputTokenPriceUsdPerMillion = parsedInputPrice;
      }

      if (parsedOutputPrice !== undefined) {
        payload.outputTokenPriceUsdPerMillion = parsedOutputPrice;
      }

      return api.updateSaveModelConfig(save.id, payload);
    },
    onSuccess: async () => {
      setModelApiKey("");
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });
  const clearModel = useMutation({
    mutationFn: () => api.clearSaveModelConfig(save.id),
    onSuccess: async () => {
      setModelBaseUrl("");
      setModelName("");
      setModelApiKey("");
      setInputTokenPrice("");
      setOutputTokenPrice("");
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });

  return (
    <section>
      <div className="mb-2 text-sm font-semibold text-slate-950">World settings</div>
      <div className="grid gap-2">
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Turn scale
          <input
            aria-label="World turn scale"
            className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
            value={turnTimeScale}
            onChange={(event) => setTurnTimeScale(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Randomness
          <input
            aria-label="World randomness"
            className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
            type="number"
            min={0}
            max={100}
            value={randomness}
            onChange={(event) => setRandomness(Number(event.target.value))}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Content boundary
          <input
            aria-label="World content boundary"
            className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
            value={contentBoundary}
            onChange={(event) => setContentBoundary(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Style guide
          <textarea
            aria-label="World style guide"
            className="min-h-20 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-950"
            value={styleGuide}
            onChange={(event) => setStyleGuide(event.target.value)}
          />
        </label>
      </div>
      <button
        className="mt-2 inline-flex h-8 items-center gap-2 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-60"
        type="button"
        disabled={settings.isPending}
        onClick={() => settings.mutate()}
      >
        <SaveIcon size={14} />
        Save settings
      </button>
      {settings.error ? <p className="mt-2 text-sm text-red-600">{settings.error.message}</p> : null}
      <div className="mt-5 border-t border-slate-200 pt-4">
        <div className="mb-2 text-sm font-semibold text-slate-950">Save model config</div>
        <div className="grid gap-2">
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Base URL
            <input
              aria-label="Save model base URL"
              className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
              value={modelBaseUrl}
              onChange={(event) => setModelBaseUrl(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Model
            <input
              aria-label="Save model"
              className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            API key
            <input
              aria-label="Save model API key"
              className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
              type="password"
              value={modelApiKey}
              onChange={(event) => setModelApiKey(event.target.value)}
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Input $ / 1M tokens
              <input
                aria-label="Save model input token price"
                className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
                min={0}
                step="0.000001"
                type="number"
                value={inputTokenPrice}
                onChange={(event) => setInputTokenPrice(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Output $ / 1M tokens
              <input
                aria-label="Save model output token price"
                className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
                min={0}
                step="0.000001"
                type="number"
                value={outputTokenPrice}
                onChange={(event) => setOutputTokenPrice(event.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {save.modelConfig
            ? `Override ${save.modelConfig.model}${save.modelConfig.hasApiKey && save.modelConfig.apiKeyTail ? ` · key ${save.modelConfig.apiKeyTail}` : ""}`
            : "Global model config"}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className="inline-flex h-8 items-center gap-2 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-60"
            type="button"
            disabled={saveModel.isPending}
            onClick={() => saveModel.mutate()}
          >
            <SaveIcon size={14} />
            Save model config
          </button>
          <button
            className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 disabled:opacity-60"
            type="button"
            disabled={clearModel.isPending || !save.modelConfig}
            onClick={() => clearModel.mutate()}
          >
            Clear model config
          </button>
        </div>
        {saveModel.error ? <p className="mt-2 text-sm text-red-600">{saveModel.error.message}</p> : null}
        {clearModel.error ? <p className="mt-2 text-sm text-red-600">{clearModel.error.message}</p> : null}
      </div>
    </section>
  );
}

function CharacterCard({
  saveId,
  locations,
  character
}: {
  saveId: string;
  locations: Location[];
  character: Character;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(character.name);
  const [profile, setProfile] = useState(character.profile);
  const [personality, setPersonality] = useState(character.personality);
  const [longTermGoal, setLongTermGoal] = useState(character.longTermGoal);
  const [shortTermGoal, setShortTermGoal] = useState(character.shortTermGoal);
  const [locationId, setLocationId] = useState(character.locationId);
  const [status, setStatus] = useState(character.status);
  const [secrets, setSecrets] = useState(character.secrets.join("\n"));
  const [privateMemory, setPrivateMemory] = useState(character.privateMemory.join("\n"));
  const characterUpdate = useMutation({
    mutationFn: () =>
      api.patchCharacter(saveId, character.id, {
        name,
        profile,
        personality,
        longTermGoal,
        shortTermGoal,
        locationId,
        status,
        secrets: splitLines(secrets),
        privateMemory: splitLines(privateMemory)
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["save", saveId] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });
  const characterDelete = useMutation({
    mutationFn: () => api.deleteCharacter(saveId, character.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["save", saveId] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <label className="grid gap-1 text-xs font-medium text-slate-600">
        Name
        <input
          aria-label={`${character.name} name`}
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="mt-2 grid gap-1 text-xs font-medium text-slate-600">
        Profile
        <textarea
          aria-label={`${character.name} profile`}
          className="min-h-16 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-950"
          value={profile}
          onChange={(event) => setProfile(event.target.value)}
        />
      </label>
      <label className="mt-2 grid gap-1 text-xs font-medium text-slate-600">
        Personality
        <input
          aria-label={`${character.name} personality`}
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={personality}
          onChange={(event) => setPersonality(event.target.value)}
        />
      </label>
      <label className="mt-2 grid gap-1 text-xs font-medium text-slate-600">
        Long goal
        <input
          aria-label={`${character.name} long goal`}
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={longTermGoal}
          onChange={(event) => setLongTermGoal(event.target.value)}
        />
      </label>
      <label className="mt-2 grid gap-1 text-xs font-medium text-slate-600">
        Short goal
        <input
          aria-label={`${character.name} short goal`}
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={shortTermGoal}
          onChange={(event) => setShortTermGoal(event.target.value)}
        />
      </label>
      <label className="mt-2 grid gap-1 text-xs font-medium text-slate-600">
        Location
        <select
          aria-label={`${character.name} location`}
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
        >
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-2 grid gap-1 text-xs font-medium text-slate-600">
        Status
        <input
          aria-label={`${character.name} status`}
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        />
      </label>
      <label className="mt-2 grid gap-1 text-xs font-medium text-slate-600">
        Secrets
        <textarea
          aria-label={`${character.name} secrets`}
          className="min-h-16 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-950"
          value={secrets}
          onChange={(event) => setSecrets(event.target.value)}
        />
      </label>
      <label className="mt-2 grid gap-1 text-xs font-medium text-slate-600">
        Private memory
        <textarea
          aria-label={`${character.name} private memory`}
          className="min-h-16 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-950"
          value={privateMemory}
          onChange={(event) => setPrivateMemory(event.target.value)}
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          type="button"
          disabled={characterUpdate.isPending}
          onClick={() => characterUpdate.mutate()}
        >
          <SaveIcon size={14} />
          Save character
        </button>
        <button
          className="inline-flex h-8 items-center gap-2 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          type="button"
          disabled={characterDelete.isPending}
          onClick={() => characterDelete.mutate()}
        >
          Delete
        </button>
      </div>
      {characterUpdate.error ? <p className="mt-2 text-sm text-red-600">{characterUpdate.error.message}</p> : null}
      {characterDelete.error ? <p className="mt-2 text-sm text-red-600">{characterDelete.error.message}</p> : null}
    </div>
  );
}

function AddCharacterForm({ save }: { save: Save }) {
  const queryClient = useQueryClient();
  const firstLocation = save.locations[0];
  const [name, setName] = useState("New character");
  const [locationId, setLocationId] = useState(firstLocation?.id ?? "");
  const add = useMutation({
    mutationFn: () =>
      api.createCharacter(save.id, {
        name,
        profile: "",
        personality: "",
        longTermGoal: "",
        shortTermGoal: "",
        locationId,
        status: "Available",
        secrets: [],
        privateMemory: []
      }),
    onSuccess: async () => {
      setName("New character");
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });

  return (
    <div className="rounded-md border border-dashed border-slate-300 p-3">
      <div className="grid gap-2">
        <input
          aria-label="New character name"
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          aria-label="New character location"
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
        >
          {save.locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </div>
      <button
        className="mt-2 inline-flex h-8 items-center gap-2 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-60"
        type="button"
        disabled={add.isPending || !locationId}
        onClick={() => add.mutate()}
      >
        <Plus size={14} />
        Add character
      </button>
      {add.error ? <p className="mt-2 text-sm text-red-600">{add.error.message}</p> : null}
    </div>
  );
}

function LocationCard({ save, location }: { save: Save; location: Location }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(location.name);
  const [description, setDescription] = useState(location.description);
  const [status, setStatus] = useState(location.status);
  const update = useMutation({
    mutationFn: () => api.patchLocation(save.id, location.id, { name, description, status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });
  const remove = useMutation({
    mutationFn: () => api.deleteLocation(save.id, location.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <label className="grid gap-1 text-xs font-medium text-slate-600">
        Name
        <input
          aria-label={`${location.name} location name`}
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="mt-2 grid gap-1 text-xs font-medium text-slate-600">
        Description
        <textarea
          aria-label={`${location.name} location description`}
          className="min-h-16 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-950"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="mt-2 grid gap-1 text-xs font-medium text-slate-600">
        Status
        <input
          aria-label={`${location.name} location status`}
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          type="button"
          disabled={update.isPending}
          onClick={() => update.mutate()}
        >
          <SaveIcon size={14} />
          Save location
        </button>
        <button
          className="inline-flex h-8 items-center gap-2 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          type="button"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Delete
        </button>
      </div>
      {update.error ? <p className="mt-2 text-sm text-red-600">{update.error.message}</p> : null}
      {remove.error ? <p className="mt-2 text-sm text-red-600">{remove.error.message}</p> : null}
    </div>
  );
}

function AddLocationForm({ saveId }: { saveId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("New location");
  const add = useMutation({
    mutationFn: () => api.createLocation(saveId, { name, description: "", status: "Open" }),
    onSuccess: async () => {
      setName("New location");
      await queryClient.invalidateQueries({ queryKey: ["save", saveId] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });

  return (
    <div className="rounded-md border border-dashed border-slate-300 p-3">
      <input
        aria-label="New location name"
        className="h-8 w-full rounded-md border border-slate-300 px-2 text-sm text-slate-950"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button
        className="mt-2 inline-flex h-8 items-center gap-2 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-60"
        type="button"
        disabled={add.isPending}
        onClick={() => add.mutate()}
      >
        <Plus size={14} />
        Add location
      </button>
      {add.error ? <p className="mt-2 text-sm text-red-600">{add.error.message}</p> : null}
    </div>
  );
}

function RelationshipCard({ save, relationship }: { save: Save; relationship: Relationship }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(relationship.label);
  const [strength, setStrength] = useState(relationship.strength);
  const [summary, setSummary] = useState(relationship.summary);
  const characterName = (id: string) => save.characters.find((character) => character.id === id)?.name ?? id;
  const update = useMutation({
    mutationFn: () => api.patchRelationship(save.id, relationship.id, { label, strength, summary }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });
  const remove = useMutation({
    mutationFn: () => api.deleteRelationship(save.id, relationship.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="text-xs font-medium text-slate-500">
        {characterName(relationship.sourceCharacterId)} {"->"} {characterName(relationship.targetCharacterId)}
      </div>
      <label className="mt-2 grid gap-1 text-xs font-medium text-slate-600">
        Label
        <input
          aria-label={`${relationship.id} relationship label`}
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label className="mt-2 grid gap-1 text-xs font-medium text-slate-600">
        Strength
        <input
          aria-label={`${relationship.id} relationship strength`}
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          type="number"
          min={-100}
          max={100}
          value={strength}
          onChange={(event) => setStrength(Number(event.target.value))}
        />
      </label>
      <label className="mt-2 grid gap-1 text-xs font-medium text-slate-600">
        Summary
        <textarea
          aria-label={`${relationship.id} relationship summary`}
          className="min-h-16 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-950"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          type="button"
          disabled={update.isPending}
          onClick={() => update.mutate()}
        >
          <SaveIcon size={14} />
          Save relationship
        </button>
        <button
          className="inline-flex h-8 items-center gap-2 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          type="button"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Delete
        </button>
      </div>
      {update.error ? <p className="mt-2 text-sm text-red-600">{update.error.message}</p> : null}
      {remove.error ? <p className="mt-2 text-sm text-red-600">{remove.error.message}</p> : null}
    </div>
  );
}

function AddRelationshipForm({ save }: { save: Save }) {
  const queryClient = useQueryClient();
  const [sourceCharacterId, setSourceCharacterId] = useState(save.characters[0]?.id ?? "");
  const [targetCharacterId, setTargetCharacterId] = useState(save.characters[1]?.id ?? save.characters[0]?.id ?? "");
  const [label, setLabel] = useState("Contact");
  const add = useMutation({
    mutationFn: () =>
      api.createRelationship(save.id, {
        sourceCharacterId,
        targetCharacterId,
        label,
        strength: 0,
        summary: ""
      }),
    onSuccess: async () => {
      setLabel("Contact");
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });

  return (
    <div className="rounded-md border border-dashed border-slate-300 p-3">
      <div className="grid gap-2">
        <select
          aria-label="New relationship source"
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={sourceCharacterId}
          onChange={(event) => setSourceCharacterId(event.target.value)}
        >
          {save.characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>
        <select
          aria-label="New relationship target"
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={targetCharacterId}
          onChange={(event) => setTargetCharacterId(event.target.value)}
        >
          {save.characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>
        <input
          aria-label="New relationship label"
          className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-950"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </div>
      <button
        className="mt-2 inline-flex h-8 items-center gap-2 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-60"
        type="button"
        disabled={add.isPending || sourceCharacterId === targetCharacterId}
        onClick={() => add.mutate()}
      >
        <Plus size={14} />
        Add relationship
      </button>
      {add.error ? <p className="mt-2 text-sm text-red-600">{add.error.message}</p> : null}
    </div>
  );
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalPrice(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function formatTurnUsage(callSummary: Save["turns"][number]["callSummary"], t: (key: string) => string) {
  const parts = [
    callSummary.provider ?? callSummary.model,
    `${callSummary.calls} call`,
    usageTokenText(callSummary),
    `${callSummary.durationMs} ms`,
    callSummary.estimatedCostUsd !== undefined
      ? `$${callSummary.estimatedCostUsd.toFixed(6)}`
      : t("world.costNotConfigured")
  ];

  if (callSummary.estimatedUsage) {
    parts.push(t("world.usageEstimated"));
  }

  return parts.filter(Boolean).join(" · ");
}

function usageTokenText(callSummary: Save["turns"][number]["callSummary"]) {
  if (callSummary.inputTokens !== undefined || callSummary.outputTokens !== undefined) {
    return `${callSummary.inputTokens ?? 0} in / ${callSummary.outputTokens ?? 0} out / ${
      callSummary.totalTokens ?? callSummary.estimatedTokens
    } total tokens`;
  }

  return `~${callSummary.estimatedTokens} tokens`;
}

function EmptyWorld() {
  const { t } = useTranslation();

  return (
    <div className="grid min-h-[680px] place-items-center p-6 text-center">
      <div>
        <Sparkles className="mx-auto mb-3 text-slate-400" />
        <h1 className="text-xl font-semibold text-slate-950">{t("world.createStartTitle")}</h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{t("world.createStartBody")}</p>
      </div>
    </div>
  );
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
