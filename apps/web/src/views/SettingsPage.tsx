import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, FlaskConical, RefreshCw, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";

type SettingsForm = {
  baseUrl: string;
  model: string;
  apiKey: string;
  inputTokenPriceUsdPerMillion: string;
  outputTokenPriceUsdPerMillion: string;
};

export function SettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const appHealth = useQuery({ queryKey: ["health"], queryFn: api.health });
  const config = useQuery({ queryKey: ["model-config"], queryFn: api.modelConfig });
  const modelHealth = useQuery({ queryKey: ["model-health"], queryFn: api.modelHealth });
  const { register, handleSubmit, reset } = useForm<SettingsForm>({
    values: {
      baseUrl: config.data?.baseUrl ?? "https://api.openai.com/v1",
      model: config.data?.model ?? "gpt-4.1-mini",
      apiKey: "",
      inputTokenPriceUsdPerMillion: config.data?.inputTokenPriceUsdPerMillion?.toString() ?? "",
      outputTokenPriceUsdPerMillion: config.data?.outputTokenPriceUsdPerMillion?.toString() ?? ""
    }
  });
  const update = useMutation({
    mutationFn: async (values: SettingsForm) => {
      const probe = await api.probeModelConfig({
        baseUrl: values.baseUrl,
        model: values.model,
        apiKey: values.apiKey
      });

      if (!probe.ok) {
        throw new Error(probe.error?.message ?? t("settings.connectionFailed"));
      }

      const saved = await api.updateModelConfig({
        baseUrl: values.baseUrl,
        model: values.model,
        apiKey: values.apiKey,
        ...pricePayload(values),
        supportsJsonMode: Boolean(probe.config.supportsJsonMode),
        supportsUsage: Boolean(probe.config.supportsUsage),
        supportsStream: Boolean(probe.config.supportsStream)
      });

      return { probe, saved };
    },
    onSuccess: async (result) => {
      reset({
        apiKey: "",
        baseUrl: result.saved.baseUrl,
        model: result.saved.model,
        inputTokenPriceUsdPerMillion: result.saved.inputTokenPriceUsdPerMillion?.toString() ?? "",
        outputTokenPriceUsdPerMillion: result.saved.outputTokenPriceUsdPerMillion?.toString() ?? ""
      });
      await queryClient.invalidateQueries({ queryKey: ["model-config"] });
      await queryClient.invalidateQueries({ queryKey: ["model-health"] });
    }
  });
  const smokeTest = useMutation({
    mutationFn: api.runModelSmokeTest,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["model-health"] });
    }
  });

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold text-slate-950">{t("settings.title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("settings.body")}</p>
        </div>
        <form
          className="grid max-w-2xl gap-4"
          onSubmit={(event) => void handleSubmit((values) => update.mutate(values))(event)}
        >
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            {t("settings.baseUrl")}
            <input
              className="h-10 rounded-md border border-slate-300 px-3"
              {...register("baseUrl", { required: true })}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            {t("settings.model")}
            <input
              className="h-10 rounded-md border border-slate-300 px-3"
              {...register("model", { required: true })}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            {t("settings.apiKey")}
            <input className="h-10 rounded-md border border-slate-300 px-3" type="password" {...register("apiKey")} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              {t("settings.inputTokenPrice")}
              <input
                className="h-10 rounded-md border border-slate-300 px-3"
                min={0}
                step="0.000001"
                type="number"
                {...register("inputTokenPriceUsdPerMillion")}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              {t("settings.outputTokenPrice")}
              <input
                className="h-10 rounded-md border border-slate-300 px-3"
                min={0}
                step="0.000001"
                type="number"
                {...register("outputTokenPriceUsdPerMillion")}
              />
            </label>
          </div>
          <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            {t("settings.currentKey")}:{" "}
            {config.data?.hasApiKey
              ? t("settings.configuredEnding", { tail: config.data.apiKeyTail })
              : t("settings.notConfigured")}
          </div>
          {update.data ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              {t("settings.connectionOk", {
                provider: update.data.probe.provider,
                json: update.data.probe.config.supportsJsonMode ? t("settings.yes") : t("settings.no"),
                usage: update.data.probe.config.supportsUsage ? t("settings.yes") : t("settings.no"),
                stream: update.data.probe.config.supportsStream ? t("settings.yes") : t("settings.no")
              })}
            </div>
          ) : null}
          <button
            className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
            type="submit"
            disabled={update.isPending}
          >
            <Save size={16} />
            {update.isPending ? t("settings.testing") : t("settings.save")}
          </button>
          {update.error ? <p className="text-sm text-red-600">{update.error.message}</p> : null}
        </form>
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{t("settings.healthTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("settings.healthBody")}</p>
          </div>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 disabled:opacity-60"
            type="button"
            onClick={() => {
              void appHealth.refetch();
              void modelHealth.refetch();
            }}
          >
            <RefreshCw size={15} />
            {t("settings.refreshHealth")}
          </button>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Activity size={16} />
              {t("settings.appHealth")}
            </div>
            <div className="text-sm text-slate-600">
              {appHealth.data?.app.status === "ok" ? t("settings.appOk") : t("settings.loadingHealth")}
            </div>
            {appHealth.error ? <p className="mt-2 text-sm text-red-600">{appHealth.error.message}</p> : null}
          </div>
          <div className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-950">
              <FlaskConical size={16} />
              {t("settings.modelHealth")}
            </div>
            <div className="grid gap-1 text-sm text-slate-600">
              <div>{t("settings.modelHealthStatus", { status: modelHealth.data?.status ?? "..." })}</div>
              <div>{t("settings.modelHealthProvider", { provider: modelHealth.data?.provider ?? "..." })}</div>
              <div>{t("settings.modelHealthModel", { model: modelHealth.data?.model ?? "..." })}</div>
              {modelHealth.data ? (
                <div>
                  {t("settings.modelHealthMetrics", {
                    calls: modelHealth.data.recent.calls,
                    failures: modelHealth.data.recent.failures,
                    errorRate: formatPercent(modelHealth.data.recent.errorRate),
                    latency: modelHealth.data.recent.averageLatencyMs
                  })}
                </div>
              ) : null}
              {modelHealth.data?.lastError ? (
                <div className="text-red-600">
                  {modelHealth.data.lastError.code}: {modelHealth.data.lastError.message}
                </div>
              ) : null}
            </div>
            <button
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white disabled:opacity-60"
              type="button"
              disabled={smokeTest.isPending}
              onClick={() => smokeTest.mutate()}
            >
              <FlaskConical size={15} />
              {smokeTest.isPending ? t("settings.smokeTesting") : t("settings.runSmokeTest")}
            </button>
            {smokeTest.data ? (
              <p className={smokeTest.data.ok ? "mt-2 text-sm text-emerald-700" : "mt-2 text-sm text-red-600"}>
                {smokeTest.data.message}
              </p>
            ) : null}
            {smokeTest.error ? <p className="mt-2 text-sm text-red-600">{smokeTest.error.message}</p> : null}
            {modelHealth.error ? <p className="mt-2 text-sm text-red-600">{modelHealth.error.message}</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function pricePayload(values: SettingsForm) {
  const inputPrice = parseOptionalPrice(values.inputTokenPriceUsdPerMillion);
  const outputPrice = parseOptionalPrice(values.outputTokenPriceUsdPerMillion);

  return {
    ...(inputPrice !== undefined ? { inputTokenPriceUsdPerMillion: inputPrice } : {}),
    ...(outputPrice !== undefined ? { outputTokenPriceUsdPerMillion: outputPrice } : {})
  };
}

function parseOptionalPrice(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
