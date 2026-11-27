"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("owner@nexo.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "No se pudo iniciar sesión");
      router.push("/inbox");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-accent text-white">
            <span className="font-display text-lg font-bold">N</span>
          </div>
          <div>
            <p className="font-display text-lg font-bold tracking-tight">Nexo</p>
            <p className="text-xs text-muted">Inbox conversacional</p>
          </div>
        </div>

        <form onSubmit={submit} className="surface space-y-5 p-7">
          <div>
            <h1 className="text-2xl font-semibold">Bienvenido de nuevo</h1>
            <p className="mt-1 text-sm text-muted">Entra a tu espacio de conversaciones.</p>
          </div>

          <div>
            <label className="label" htmlFor="email">Correo</label>
            <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="password">Contraseña</label>
            <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <button className="btn-primary w-full" type="submit" disabled={loading}>
            {loading ? "Entrando…" : "Entrar"}
            <ArrowRight size={16} strokeWidth={1.75} />
          </button>
          <p className="flex items-center gap-2 text-xs text-muted">
            <LockKeyhole size={13} strokeWidth={1.75} />
            Las credenciales se guardan como hash; la sesión es una cookie HttpOnly.
          </p>
        </form>
      </div>
    </main>
  );
}
