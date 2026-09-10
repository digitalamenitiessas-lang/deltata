"use client";

import { useState } from "react";
import Image from "next/image";
import { supabaseBrowser } from "@/lib/auth/client";
import { useSesion } from "@/stores/sesion";
import { Button } from "@/components/ui/Button";

export function Login() {
  const setUsuario = useSesion((s) => s.setUsuario);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verPass, setVerPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { data, error: err } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (err || !data.user) {
        setError(
          err?.message === "Invalid login credentials"
            ? "El correo o la contraseña no coinciden."
            : "No pudimos iniciar sesión. Revisá tu conexión."
        );
        return;
      }
      // El perfil (nombre y rol) lo resuelve el servidor con service_role
      const res = await fetch("/api/sesion");
      if (!res.ok) {
        await supabase.auth.signOut();
        setError(
          "Tu usuario existe pero no tiene un perfil activo. Avisale al dueño."
        );
        return;
      }
      setUsuario(await res.json());
    } catch {
      setError("No pudimos iniciar sesión. Revisá tu conexión.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-7 bg-brand-900 px-6">
      <Image
        src="/logo-deltata-crema.png"
        alt="Del Tata — Empanadas Tucumanas"
        width={687}
        height={800}
        priority
        className="h-28 w-auto"
      />

      <div className="text-center">
        <h1 className="font-[family-name:var(--font-fraunces)] text-3xl font-bold text-ink-inverse">
          Del Tata
        </h1>
        <p className="mt-1 text-sm text-brand-100">Ingresá para operar</p>
      </div>

      <form onSubmit={entrar} className="flex w-full max-w-xs flex-col gap-3">
        <div>
          <label
            htmlFor="email"
            className="mb-1 block text-xs font-bold uppercase tracking-wide text-brand-100"
          >
            Correo
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-14 w-full rounded-2xl border-none bg-cream-050 px-4 text-base font-bold text-ink-950 outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1 block text-xs font-bold uppercase tracking-wide text-brand-100"
          >
            Contraseña
          </label>
          <div className="relative">
            <input
              id="password"
              type={verPass ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-14 w-full rounded-2xl border-none bg-cream-050 px-4 pr-16 text-base font-bold text-ink-950 outline-none"
            />
            <button
              type="button"
              onClick={() => setVerPass((v) => !v)}
              className="absolute right-2 top-1/2 h-11 -translate-y-1/2 rounded-xl px-3 text-xs font-bold text-ink-700"
            >
              {verPass ? "Ocultar" : "Ver"}
            </button>
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-xl bg-danger-600/15 px-3 py-2 text-sm font-bold text-[#ffd9d6]"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="gold"
          size="lg"
          disabled={busy || !email || !password}
        >
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>

      <p className="max-w-xs text-center text-xs text-brand-100/70">
        Necesitás conexión sólo para entrar. Después la app funciona sin
        internet y sincroniza cuando vuelve.
      </p>
    </main>
  );
}
