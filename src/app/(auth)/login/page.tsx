"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvexAuth } from "convex/react";
import { AlertCircle, ArrowLeft, Eye, EyeOff, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/convexApi";
// Módulo PURO de convex/ (sin imports de servidor): es seguro traerlo al
// bundle del navegador. Ver la cabecera de convex/emailUtils.ts.
import { normalizarEmail } from "../../../../convex/emailUtils";

const GOOGLE_INTENTO_KEY = "vibecrm:googleIntento";

/**
 * GER-239 — Mensaje deliberadamente ambiguo: se muestra IGUAL exista o no la
 * cuenta. Decir "ese correo no está registrado" convertiría el login en un
 * oráculo de qué correos tienen acceso al CRM.
 */
const MENSAJE_NEUTRO =
  "Si el correo corresponde a una cuenta con acceso, te enviamos un código. Revisá tu bandeja y también el spam.";

const MIN_PASSWORD = 8;

type Paso = "login" | "pedir-codigo" | "verificar";

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
  const solicitarCodigo = useAction(api.recuperacion.solicitarCodigo);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paso, setPaso] = useState<Paso>("login");
  const [aviso, setAviso] = useState<string | null>(null);
  // El correo del paso 2 se reutiliza en el 3: la librería exige que coincida
  // con el del `signIn` inicial (authorize de convex/ResendOTP.ts).
  const [emailReset, setEmailReset] = useState("");

  function irA(destino: Paso) {
    setError(null);
    setAviso(null);
    setShowPass(false);
    setPaso(destino);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    // Solo iniciamos sesión: nunca exponemos el flujo de registro en la UI.
    form.set("flow", "signIn");
    form.set("email", normalizarEmail(String(form.get("email") ?? "")));
    setSubmitting(true);
    try {
      await signIn("password", form);
      router.replace("/hoy");
    } catch {
      setError("Correo o contraseña incorrectos.");
      setSubmitting(false);
    }
  }

  async function onPedirCodigo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = normalizarEmail(String(form.get("email") ?? ""));
    setSubmitting(true);
    // Se llama a nuestra acción, NO a `signIn` directamente, porque devuelve un
    // VALOR en vez de lanzar: la marca del fallo de envío no sobrevive el viaje
    // al navegador dentro de un error. El detalle, en convex/recuperacion.ts.
    //
    // Un fallo real de envío SÍ se muestra: callarlo diría que mandamos un
    // código que nunca salió. El correo inexistente, en cambio, devuelve
    // "enviado" desde el servidor a propósito, para no revelar qué correos
    // tienen acceso.
    let resultado: "enviado" | "fallo_envio";
    try {
      resultado = await solicitarCodigo({ email });
    } catch {
      // Solo se llega acá si la acción ni siquiera pudo ejecutarse (por ejemplo
      // sin red en el navegador): tampoco se envió nada.
      resultado = "fallo_envio";
    }
    if (resultado === "fallo_envio") {
      setError("No pudimos enviar el correo. Probá de nuevo en unos minutos.");
      setSubmitting(false);
      return;
    }
    setEmailReset(email);
    setPaso("verificar");
    setAviso(MENSAJE_NEUTRO);
    setSubmitting(false);
  }

  async function onVerificar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const code = String(form.get("code") ?? "").trim();
    const newPassword = String(form.get("newPassword") ?? "");
    const repetir = String(form.get("repetir") ?? "");

    // Se valida antes de llamar: el código se consume (y se borra) en el
    // servidor al primer intento, así que un error evitable costaría pedir uno
    // nuevo.
    //
    // Estas comprobaciones viven en JS a propósito, sin `minLength` en el
    // input: el atributo hace que el navegador bloquee el envío antes y muestre
    // su propio aviso, que va en el idioma del navegador (en inglés para la
    // mayoría) y sin los estilos de la app.
    if (newPassword.length < MIN_PASSWORD) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (newPassword !== repetir) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSubmitting(true);
    try {
      await signIn("password", {
        email: emailReset,
        code,
        newPassword,
        flow: "reset-verification",
      });
      router.replace("/hoy");
    } catch {
      setError("Código incorrecto o vencido. Pedí uno nuevo si hace falta.");
      setSubmitting(false);
    }
  }

  async function onGoogleClick() {
    setError(null);
    setGoogleSubmitting(true);
    sessionStorage.setItem(GOOGLE_INTENTO_KEY, "1");
    // GER-238: el origen va explícito. Un destino relativo lo resuelve la
    // librería contra `SITE_URL`, que es uno solo, así que quien entra por un
    // dominio terminaba con la sesión puesta en el otro. El backend valida este
    // origen contra su lista blanca (`convex/auth.ts`, callback `redirect`).
    await signIn("google", { redirectTo: `${window.location.origin}/login` });
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

  const bloqueError = error && (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md border border-error bg-error-bg px-3 py-2.5 text-[13px] text-error-text"
    >
      <AlertCircle className="size-4 shrink-0" aria-hidden />
      {error}
    </div>
  );

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
          {paso === "login" && (
            <>
              <h1 className="text-xl font-semibold text-text">Inicia sesión</h1>
              <p className="mt-1 text-sm text-text-muted">
                Entra para ver tus tareas del día.
              </p>

              <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
                {bloqueError}

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
                    aria-label={
                      showPass ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
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
                  onClick={() => irA("pedir-codigo")}
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
            </>
          )}

          {paso === "pedir-codigo" && (
            <>
              <h1 className="text-xl font-semibold text-text">
                Recuperar contraseña
              </h1>
              <p className="mt-1 text-sm text-text-muted">
                Escribí tu correo y te enviamos un código para crear una
                contraseña nueva.
              </p>

              <form
                onSubmit={onPedirCodigo}
                className="mt-5 flex flex-col gap-4"
              >
                {bloqueError}

                <Input
                  label="Correo"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  placeholder="tu@correo.com"
                />

                <Button type="submit" loading={submitting} className="w-full">
                  Enviar código
                </Button>

                <button
                  type="button"
                  onClick={() => irA("login")}
                  className="flex items-center justify-center gap-1.5 text-[13px] text-text-muted hover:text-text"
                >
                  <ArrowLeft className="size-4" aria-hidden />
                  Volver a iniciar sesión
                </button>
              </form>
            </>
          )}

          {paso === "verificar" && (
            <>
              <h1 className="text-xl font-semibold text-text">
                Escribí el código
              </h1>
              <p className="mt-1 text-sm text-text-muted">
                Te lo enviamos a <span className="text-text">{emailReset}</span>.
                Vence en 15 minutos.
              </p>

              <form onSubmit={onVerificar} className="mt-5 flex flex-col gap-4">
                {aviso && (
                  <div
                    role="status"
                    className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[13px] text-text-muted"
                  >
                    <MailCheck
                      className="mt-0.5 size-4 shrink-0"
                      aria-hidden
                    />
                    {aviso}
                  </div>
                )}

                {bloqueError}

                <Input
                  label="Código"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  autoFocus
                  required
                  placeholder="12345678"
                />

                <div className="relative">
                  <Input
                    label="Contraseña nueva"
                    name="newPassword"
                    type={showPass ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    placeholder="••••••••"
                    className="pr-11"
                    helper={`Mínimo ${MIN_PASSWORD} caracteres.`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    aria-label={
                      showPass ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
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

                <Input
                  label="Repetir contraseña"
                  name="repetir"
                  type={showPass ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  placeholder="••••••••"
                />

                <Button type="submit" loading={submitting} className="w-full">
                  Cambiar contraseña y entrar
                </Button>

                <button
                  type="button"
                  onClick={() => irA("pedir-codigo")}
                  className="flex items-center justify-center gap-1.5 text-[13px] text-text-muted hover:text-text"
                >
                  <ArrowLeft className="size-4" aria-hidden />
                  Usar otro correo o pedir un código nuevo
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
