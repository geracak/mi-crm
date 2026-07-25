"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const GOOGLE_INTENTO_KEY = "vibecrm:googleIntento";

function GoogleIcon() {
  return (
    <svg className="size-[18px]" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.16.28-1.7V4.97H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.03l3.05-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 4.97l3.05 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    // Solo iniciamos sesión: nunca exponemos el flujo de registro en la UI.
    form.set("flow", "signIn");
    setSubmitting(true);
    try {
      await signIn("password", form);
      router.replace("/hoy");
    } catch {
      setError("Correo o contraseña incorrectos.");
      setSubmitting(false);
    }
  }

  async function onGoogleClick() {
    setError(null);
    setGoogleSubmitting(true);
    sessionStorage.setItem(GOOGLE_INTENTO_KEY, "1");
    await signIn("google", { redirectTo: "/login" });
  }

  // GER-238: `@convex-dev/auth` solo hace `history.replaceState` al consumir el
  // `?code=` de vuelta de Google — no navega solo. El backend tampoco expone el
  // motivo del rechazo (lo atrapa y redirige sin parámetro de error), así que
  // usamos un marcador propio + el estado de auth para decidir a qué lado cae.
  useEffect(() => {
    if (!sessionStorage.getItem(GOOGLE_INTENTO_KEY)) return;
    if (isLoading) return; // esperar a que el SDK termine de intercambiar ?code=
    sessionStorage.removeItem(GOOGLE_INTENTO_KEY);
    // El cambio de estado viene de un sistema externo (el SDK de auth
    // resolviendo el ?code= de Google) resuelto en este mismo tick; se agenda
    // como callback para no actualizar el estado de forma síncrona en el
    // cuerpo del efecto.
    queueMicrotask(() => {
      if (isAuthenticated) {
        router.replace("/hoy");
      } else {
        setGoogleSubmitting(false);
        setError(
          "No pudimos completar el inicio de sesión con Google. Si tu cuenta no tiene acceso, contactá a la persona dueña del CRM.",
        );
      }
    });
  }, [isAuthenticated, isLoading, router]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex size-[34px] items-center justify-center rounded-[9px] bg-primary text-[17px] font-semibold text-on-primary">
            V
          </span>
          <span className="text-lg font-semibold text-text">Vibe CRM</span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-text">Inicia sesión</h1>
          <p className="mt-1 text-sm text-text-muted">
            Entra para ver tus tareas del día.
          </p>

          <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-md border border-error bg-error-bg px-3 py-2.5 text-[13px] text-error-text"
              >
                <AlertCircle className="size-4 shrink-0" aria-hidden />
                {error}
              </div>
            )}

            <Input
              label="Correo"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              placeholder="tu@correo.com"
            />

            <div className="relative">
              <Input
                label="Contraseña"
                name="password"
                type={showPass ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="••••••••"
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-pressed={showPass}
                className="absolute right-2 top-[34px] flex size-9 items-center justify-center rounded-md text-text-subtle hover:bg-surface-2"
              >
                {showPass ? (
                  <EyeOff className="size-[18px]" aria-hidden />
                ) : (
                  <Eye className="size-[18px]" aria-hidden />
                )}
              </button>
            </div>

            <Button type="submit" loading={submitting} className="w-full">
              Entrar
            </Button>

            <button
              type="button"
              onClick={() =>
                setError("La recuperación de contraseña llegará pronto.")
              }
              className="text-center text-[13px] text-text-muted hover:text-text"
            >
              ¿Olvidaste tu contraseña?
            </button>
          </form>

          <div className="my-4 flex items-center gap-3" aria-hidden>
            <div className="h-px flex-1 bg-border" />
            <span className="text-[13px] text-text-muted">o</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="secondary"
            className="w-full"
            loading={googleSubmitting}
            iconLeft={<GoogleIcon />}
            onClick={onGoogleClick}
          >
            Continuar con Google
          </Button>
        </div>
      </div>
    </main>
  );
}
