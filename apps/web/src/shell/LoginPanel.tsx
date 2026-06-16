import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useForm } from "react-hook-form";
import { api } from "../api/client.js";

type LoginForm = {
  password: string;
};

export function LoginPanel() {
  const queryClient = useQueryClient();
  const { register, handleSubmit } = useForm<LoginForm>({ defaultValues: { password: "fantasyworld" } });
  const login = useMutation({
    mutationFn: (values: LoginForm) => api.login(values.password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    }
  });

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f3ec] px-4">
      <form
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={(event) => void handleSubmit((values) => login.mutate(values))(event)}
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-slate-950 text-white">
            <KeyRound size={18} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-950">FantasyWorld</h1>
            <p className="text-sm text-slate-500">Single-player GM console</p>
          </div>
        </div>
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Admin password
          <input
            className="h-10 rounded-md border border-slate-300 px-3 text-slate-950 outline-none focus:border-slate-950"
            type="password"
            {...register("password", { required: true })}
          />
        </label>
        {login.error ? <p className="mt-3 text-sm text-red-600">{login.error.message}</p> : null}
        <button
          className="mt-5 h-10 w-full rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
          type="submit"
          disabled={login.isPending}
        >
          {login.isPending ? "Signing in..." : "Enter"}
        </button>
      </form>
    </main>
  );
}
