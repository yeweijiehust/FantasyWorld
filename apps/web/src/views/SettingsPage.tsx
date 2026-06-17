import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { api } from "../api/client.js";

type SettingsForm = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ["model-config"], queryFn: api.modelConfig });
  const { register, handleSubmit, reset } = useForm<SettingsForm>({
    values: {
      baseUrl: config.data?.baseUrl ?? "https://api.openai.com/v1",
      model: config.data?.model ?? "gpt-4.1-mini",
      apiKey: ""
    }
  });
  const update = useMutation({
    mutationFn: async (values: SettingsForm) => {
      const probe = await api.probeModelConfig(values);

      if (!probe.ok) {
        throw new Error(probe.error?.message ?? "Model connection failed");
      }

      const saved = await api.updateModelConfig({
        ...values,
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
        model: result.saved.model
      });
      await queryClient.invalidateQueries({ queryKey: ["model-config"] });
    }
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-950">Model settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Prototype calls use a mock provider, but the configuration surface is wired for OpenAI-compatible models.
        </p>
      </div>
      <form
        className="grid max-w-2xl gap-4"
        onSubmit={(event) => void handleSubmit((values) => update.mutate(values))(event)}
      >
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Base URL
          <input
            className="h-10 rounded-md border border-slate-300 px-3"
            {...register("baseUrl", { required: true })}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Model
          <input className="h-10 rounded-md border border-slate-300 px-3" {...register("model", { required: true })} />
        </label>
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          API key
          <input className="h-10 rounded-md border border-slate-300 px-3" type="password" {...register("apiKey")} />
        </label>
        <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          Current key: {config.data?.hasApiKey ? `configured ending ${config.data.apiKeyTail}` : "not configured"}
        </div>
        {update.data ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            Connection ok via {update.data.probe.provider}: JSON{" "}
            {update.data.probe.config.supportsJsonMode ? "yes" : "no"}, usage{" "}
            {update.data.probe.config.supportsUsage ? "yes" : "no"}, stream{" "}
            {update.data.probe.config.supportsStream ? "yes" : "no"}.
          </div>
        ) : null}
        <button
          className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
          type="submit"
          disabled={update.isPending}
        >
          <Save size={16} />
          {update.isPending ? "Testing..." : "Save settings"}
        </button>
        {update.error ? <p className="text-sm text-red-600">{update.error.message}</p> : null}
      </form>
    </div>
  );
}
