import {
  WORLD_TEMPLATES,
  createTemplateSaveInput,
  type Character,
  type CreateSaveInput,
  type Language,
  type Save
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
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useUiStore } from "../state/ui.js";

const wizardSteps = ["Template", "World", "Cast", "Rules", "Draft"];
const defaultTemplateInput = createTemplateSaveInput("fantasy-frontier", "zh");

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
      <aside className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-950">Saves</h2>
          <span className="text-xs text-slate-500">{saves.data?.length ?? 0}</span>
        </div>
        <div className="grid gap-2">
          {saves.isLoading ? <div className="text-sm text-slate-500">Loading saves...</div> : null}
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
              <div className="font-medium">{item.name}</div>
              <div className={selectedSaveId === item.id ? "text-slate-300" : "text-slate-500"}>
                Turn {item.turnNumber} · {item.characterCount} chars
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

      <section className="min-h-[680px] rounded-lg border border-slate-200 bg-white">
        {activeSave ? <Timeline save={activeSave} /> : <EmptyWorld />}
      </section>

      <aside className="rounded-lg border border-slate-200 bg-white p-4">
        {activeSave ? (
          <WorldDetails save={activeSave} />
        ) : (
          <div className="text-sm text-slate-500">No world selected.</div>
        )}
      </aside>
    </div>
  );
}

function CreateSavePanel({ onCreated }: { onCreated: (save: Save) => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<WizardValues>(() => toWizardValues(defaultTemplateInput));
  const [seedText, setSeedText] = useState(defaultTemplateInput.characterSeeds.join("\n"));
  const [formError, setFormError] = useState("");
  const generation = useMutation({
    mutationFn: api.createGenerationJob,
    onSuccess: () => setStep(4)
  });
  const [importError, setImportError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const accept = useMutation({
    mutationFn: api.acceptGenerationJob,
    onSuccess: async (save) => {
      const nextInput = createTemplateSaveInput(values.templateId, values.language);
      setValues(toWizardValues(nextInput, values));
      setSeedText(nextInput.characterSeeds.join("\n"));
      setStep(0);
      generation.reset();
      await onCreated(save);
    }
  });
  const importSave = useMutation({
    mutationFn: api.importSave,
    onSuccess: async (save) => {
      setImportError("");
      setImportMessage("Imported");
      await onCreated(save);
    },
    onError: (error) => {
      setImportMessage("");
      setImportError(error.message);
    }
  });
  const selectedTemplate = WORLD_TEMPLATES.find((template) => template.id === values.templateId) ?? WORLD_TEMPLATES[0];
  const characterSeeds = seedText
    .split("\n")
    .map((seed) => seed.trim())
    .filter(Boolean);

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
      setFormError("World name and premise are required.");
      return undefined;
    }

    if (characterSeeds.length < 3 || characterSeeds.length > 8) {
      setStep(2);
      setFormError("Create 3 to 8 character seeds.");
      return undefined;
    }

    const input: CreateSaveInput = {
      templateId: values.templateId,
      name: values.name.trim(),
      premise: values.premise.trim(),
      characterSeeds,
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
      setFormError("World name and premise are required.");
      return;
    }

    if (step === 2 && (characterSeeds.length < 3 || characterSeeds.length > 8)) {
      setFormError("Create 3 to 8 character seeds.");
      return;
    }

    setFormError("");
    setStep((current) => Math.min(current + 1, wizardSteps.length - 1));
  };
  const resetDraft = () => {
    generation.reset();
    setStep(0);
  };
  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as Save | { save: Save };
      const imported = typeof parsed === "object" && parsed !== null && "save" in parsed ? parsed.save : parsed;
      importSave.mutate(imported);
    } catch (error) {
      setImportMessage("");
      setImportError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
        <Plus size={16} />
        New world
      </div>
      <div className="grid grid-cols-5 gap-1" aria-label="Create world steps">
        {wizardSteps.map((item, index) => (
          <button
            key={item}
            className={`h-8 rounded-md text-[11px] font-medium ${
              step === index ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
            type="button"
            onClick={() => setStep(index)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 text-sm">
        {step === 0 ? (
          <div className="grid gap-3">
            <label className="grid gap-2 font-medium text-slate-700">
              Language
              <select
                aria-label="World language"
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
              World name
              <input
                aria-label="World name"
                className="h-9 rounded-md border border-slate-300 px-3"
                value={values.name}
                onChange={(event) => updateValue("name", event.target.value)}
              />
            </label>
            <label className="grid gap-2 font-medium text-slate-700">
              Premise
              <textarea
                aria-label="Premise"
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
              Character seeds
              <textarea
                aria-label="Character seeds"
                className="min-h-28 rounded-md border border-slate-300 px-3 py-2"
                value={seedText}
                onChange={(event) => {
                  setSeedText(event.target.value);
                  setFormError("");
                }}
              />
            </label>
            <div className={characterSeeds.length < 3 || characterSeeds.length > 8 ? "text-red-600" : "text-slate-500"}>
              {characterSeeds.length} / 3-8 characters
            </div>
          </div>
        ) : null}
        {step === 3 ? (
          <div className="grid gap-3">
            <label className="grid gap-2 font-medium text-slate-700">
              Content boundary
              <input
                aria-label="Content boundary"
                className="h-9 rounded-md border border-slate-300 px-3"
                value={values.contentBoundary}
                onChange={(event) => updateValue("contentBoundary", event.target.value)}
              />
            </label>
            <label className="grid gap-2 font-medium text-slate-700">
              Turn scale
              <input
                aria-label="Turn scale"
                className="h-9 rounded-md border border-slate-300 px-3"
                value={values.turnTimeScale}
                onChange={(event) => updateValue("turnTimeScale", event.target.value)}
              />
            </label>
            <label className="grid gap-2 font-medium text-slate-700">
              Randomness
              <input
                aria-label="Randomness"
                className="h-9 rounded-md border border-slate-300 px-3"
                type="number"
                min={0}
                max={100}
                value={values.randomness}
                onChange={(event) => updateValue("randomness", Number(event.target.value))}
              />
            </label>
            <label className="grid gap-2 font-medium text-slate-700">
              Style guide
              <textarea
                aria-label="Style guide"
                className="min-h-20 rounded-md border border-slate-300 px-3 py-2"
                value={values.styleGuide}
                onChange={(event) => updateValue("styleGuide", event.target.value)}
              />
            </label>
            <label className="grid gap-2 font-medium text-slate-700">
              Model base URL
              <input
                aria-label="Model base URL"
                className="h-9 rounded-md border border-slate-300 px-3"
                value={values.modelBaseUrl}
                onChange={(event) => updateValue("modelBaseUrl", event.target.value)}
              />
            </label>
            <label className="grid gap-2 font-medium text-slate-700">
              Model
              <input
                aria-label="Model override"
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
              Generate draft
            </button>
            {generation.data?.draft ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
                <div className="font-semibold">Draft ready</div>
                <div className="mt-1 text-emerald-800">
                  {generation.data.draft.save.characters.length} characters ·{" "}
                  {generation.data.draft.save.locations[0]?.name}
                </div>
                <div className="mt-2 text-xs text-emerald-800">
                  {generation.data.draft.save.worldMemory.worldSummary}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {generation.data.draft.save.characters.map((character) => (
                    <span key={character.id} className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-900">
                      {character.name}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="h-8 rounded-md bg-emerald-700 px-3 text-white disabled:opacity-60"
                    type="button"
                    disabled={accept.isPending}
                    onClick={() => accept.mutate(generation.data.id)}
                  >
                    Accept draft
                  </button>
                  <button className="h-8 rounded-md bg-white px-3 text-emerald-800" type="button" onClick={resetDraft}>
                    Revise
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
            Back
          </button>
          {step < wizardSteps.length - 1 ? (
            <button className="h-8 rounded-md bg-slate-950 px-3 text-white" type="button" onClick={nextStep}>
              Next
            </button>
          ) : null}
        </div>
      </div>
      {formError ? <p className="mt-2 text-sm text-red-600">{formError}</p> : null}
      {generation.error ? <p className="mt-2 text-sm text-red-600">{generation.error.message}</p> : null}
      {accept.error ? <p className="mt-2 text-sm text-red-600">{accept.error.message}</p> : null}
      <label className="mt-3 grid gap-2 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-2">
          <Upload size={14} />
          Import JSON
        </span>
        <input
          aria-label="Import save JSON"
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
  const queryClient = useQueryClient();
  const [instruction, setInstruction] = useState("");
  const latestTurn = save.turns.at(-1);
  const turn = useMutation({
    mutationFn: () => api.createTurn(save.id, { gmInstruction: instruction, idempotencyKey: crypto.randomUUID() }),
    onSuccess: async () => {
      setInstruction("");
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });
  const rollback = useMutation({
    mutationFn: () => api.rollbackSave(save.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });
  const acceptTurn = useMutation({
    mutationFn: () => {
      if (!latestTurn) {
        throw new Error("No turn to accept");
      }

      return api.acceptTurn(latestTurn.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["save", save.id] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });
  const exportSave = useMutation({
    mutationFn: () => api.exportSave(save.id),
    onSuccess: (payload) => downloadJson(`${save.name}.fantasyworld.json`, payload)
  });

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
              Turn {save.turnNumber} · {save.settings.turnTimeScale}
            </div>
            <button
              className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              type="button"
              disabled={exportSave.isPending}
              onClick={() => exportSave.mutate()}
            >
              <Download size={14} />
              Export
            </button>
            {save.turnNumber > 0 ? (
              <button
                className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                type="button"
                disabled={rollback.isPending}
                onClick={() => rollback.mutate()}
              >
                <RotateCcw size={14} />
                Rollback
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex-1 p-4">
        {save.turns.length === 0 ? (
          <div className="grid min-h-72 place-items-center rounded-lg border border-dashed border-slate-300 text-center">
            <div>
              <BookOpen className="mx-auto mb-3 text-slate-400" />
              <div className="font-medium text-slate-800">The world is waiting for its first turn.</div>
              <div className="mt-1 text-sm text-slate-500">
                Advance once to let characters react to the opening state.
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {save.turns.map((turnItem) => (
              <article key={turnItem.id} className="rounded-lg border border-slate-200 p-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Turn {turnItem.turnNumber}
                </div>
                {turnItem.events.map((event) => (
                  <div key={event.id}>
                    <h2 className="text-lg font-semibold text-slate-950">{event.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-700">{event.body}</p>
                  </div>
                ))}
              </article>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-slate-200 p-4">
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          GM intervention
          <textarea
            className="min-h-20 rounded-md border border-slate-300 px-3 py-2 text-slate-950 outline-none focus:border-slate-950"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="让一艘陌生船只抵达港口"
          />
        </label>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
              type="button"
              disabled={turn.isPending}
              onClick={() => turn.mutate()}
            >
              <Play size={16} />
              {turn.isPending ? "Advancing..." : "Advance turn"}
            </button>
            {latestTurn ? (
              <button
                className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-200 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                type="button"
                disabled={latestTurn.status === "accepted" || acceptTurn.isPending}
                onClick={() => acceptTurn.mutate()}
              >
                <CheckCircle2 size={16} />
                {latestTurn.status === "accepted" ? "Turn accepted" : "Accept turn"}
              </button>
            ) : null}
          </div>
          <div className="text-xs text-slate-500">
            {latestTurn
              ? `${latestTurn.callSummary.calls} call · ~${latestTurn.callSummary.estimatedTokens} tokens`
              : "Mock LLM ready"}
          </div>
        </div>
        {turn.error ? <p className="mt-2 text-sm text-red-600">{turn.error.message}</p> : null}
        {rollback.error ? <p className="mt-2 text-sm text-red-600">{rollback.error.message}</p> : null}
        {acceptTurn.error ? <p className="mt-2 text-sm text-red-600">{acceptTurn.error.message}</p> : null}
        {exportSave.error ? <p className="mt-2 text-sm text-red-600">{exportSave.error.message}</p> : null}
      </div>
    </div>
  );
}

function WorldDetails({ save }: { save: Save }) {
  const latestTurn = save.turns.at(-1);
  const relationshipByCharacter = useMemo(
    () =>
      new Map(
        save.relationships.map((relationship) => [
          `${relationship.sourceCharacterId}:${relationship.targetCharacterId}`,
          relationship
        ])
      ),
    [save.relationships]
  );

  return (
    <div className="grid gap-5">
      <WorldMemoryEditor key={`${save.id}:${save.worldMemory.worldSummary}`} save={save} />
      <section>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-950">
          <Users size={16} />
          Characters
        </div>
        <div className="grid gap-2">
          {save.characters.map((character) => (
            <CharacterCard
              key={`${character.id}:${character.shortTermGoal}:${character.privateMemory.join("|")}`}
              saveId={save.id}
              character={character}
            />
          ))}
        </div>
      </section>
      <section>
        <div className="mb-2 text-sm font-semibold text-slate-950">Relationships</div>
        <div className="grid gap-2 text-sm">
          {[...relationshipByCharacter.values()].map((relationship) => (
            <div key={relationship.id} className="rounded-md border border-slate-200 p-3">
              <div className="font-medium">
                {relationship.label} · {relationship.strength}
              </div>
              <div className="mt-1 text-xs text-slate-500">{relationship.summary}</div>
            </div>
          ))}
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

function CharacterCard({ saveId, character }: { saveId: string; character: Character }) {
  const queryClient = useQueryClient();
  const [shortTermGoal, setShortTermGoal] = useState(character.shortTermGoal);
  const [privateMemory, setPrivateMemory] = useState(character.privateMemory.join("\n"));
  const characterUpdate = useMutation({
    mutationFn: () =>
      api.patchCharacter(saveId, character.id, {
        shortTermGoal,
        privateMemory: privateMemory
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean)
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["save", saveId] });
      await queryClient.invalidateQueries({ queryKey: ["saves"] });
    }
  });

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="font-medium text-slate-950">{character.name}</div>
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
        Private memory
        <textarea
          aria-label={`${character.name} private memory`}
          className="min-h-16 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-950"
          value={privateMemory}
          onChange={(event) => setPrivateMemory(event.target.value)}
        />
      </label>
      <button
        className="mt-2 inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        type="button"
        disabled={characterUpdate.isPending}
        onClick={() => characterUpdate.mutate()}
      >
        <SaveIcon size={14} />
        Save character
      </button>
      {characterUpdate.error ? <p className="mt-2 text-sm text-red-600">{characterUpdate.error.message}</p> : null}
    </div>
  );
}

function EmptyWorld() {
  return (
    <div className="grid min-h-[680px] place-items-center p-6 text-center">
      <div>
        <Sparkles className="mx-auto mb-3 text-slate-400" />
        <h1 className="text-xl font-semibold text-slate-950">Create a world to begin</h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
          The prototype starts with a generated draft, then lets you advance a mock LLM turn with visible state changes.
        </p>
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
