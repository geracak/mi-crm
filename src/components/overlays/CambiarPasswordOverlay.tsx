"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { AlertCircle } from "lucide-react";
import { api } from "@/lib/convexApi";
import { codigoError, mensajeError } from "@/lib/errores";
import { MIN_PASSWORD } from "@/lib/password";
import { useCerrarSesion } from "@/lib/useSesion";
import { Overlay } from "@/components/ui/Overlay";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface Props {
  onClose: () => void;
  onCambiada: () => void;
}

/**
 * GER-218 — Cambiar la propia contraseña.
 *
 * Las comprobaciones viven en JS y NUNCA en `minLength` del input: el atributo
 * hace que el navegador bloquee el envío con su propio aviso, en su idioma y sin
 * los estilos de la app (misma razón que en el login). Y son solo UX: quien
 * decide de verdad es el servidor.
 *
 * ⚠️ La salida para quien entra con Google aparece al FALLAR la contraseña
 * actual, no antes, porque no hay ningún dato que permita anticiparlo:
 * `passwordPendiente` se apaga en cuanto esa persona entra por Google
 * (`apagarPendienteSiGoogle`), así que una cuenta con contraseña propia y una
 * de Google con el secreto aleatorio del sistema son indistinguibles hasta que
 * se intenta usar.
 */
export function CambiarPasswordOverlay({ onClose, onCambiada }: Props) {
  const cambiarPassword = useAction(api.usuarios.cambiarPassword);
  const cerrarSesion = useCerrarSesion();

  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Solo cuando el servidor confirma que la contraseña actual no sirve. */
  const [ofrecerSalida, setOfrecerSalida] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [saliendo, setSaliendo] = useState(false);

  async function guardar() {
    setError(null);
    setOfrecerSalida(false);

    if (!actual) {
      setError("Escribí tu contraseña actual.");
      return;
    }
    if (nueva.length < MIN_PASSWORD) {
      setError(
        `La contraseña nueva debe tener al menos ${MIN_PASSWORD} caracteres.`,
      );
      return;
    }
    if (nueva !== repetir) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setGuardando(true);
    try {
      await cambiarPassword({ passwordActual: actual, passwordNueva: nueva });
      onCambiada();
      onClose();
    } catch (e) {
      setError(mensajeError(e, "No pudimos cambiar la contraseña."));
      setOfrecerSalida(codigoError(e) === "PASSWORD_ACTUAL_INCORRECTA");
      setGuardando(false);
    }
  }

  async function salirParaCrearla() {
    setSaliendo(true);
    await cerrarSesion();
  }

  return (
    <Overlay
      open
      onClose={onClose}
      title="Cambiar contraseña"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="compact"
            onClick={onClose}
            disabled={guardando || saliendo}
          >
            Cancelar
          </Button>
          <Button
            size="compact"
            loading={guardando}
            disabled={saliendo}
            onClick={guardar}
          >
            Guardar contraseña
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <div
            role="alert"
            className="flex flex-col gap-2.5 rounded-md border border-error bg-error-bg px-3 py-2.5 text-[13px] text-error-text"
          >
            <span className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" aria-hidden />
              {error}
            </span>
            {ofrecerSalida && (
              <>
                <span className="text-text-muted">
                  Si entrás con Google y nunca creaste una contraseña, no tenés
                  ninguna que cambiar: cerrá sesión y usá «¿Olvidaste tu
                  contraseña?» en la pantalla de acceso.
                </span>
                <Button
                  variant="secondary"
                  size="compact"
                  loading={saliendo}
                  onClick={salirParaCrearla}
                  className="self-start"
                >
                  Cerrar sesión y crearla
                </Button>
              </>
            )}
          </div>
        )}
        <Input
          label="Contraseña actual"
          type="password"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          autoComplete="current-password"
          placeholder="••••••••"
          autoFocus
          required
        />
        <Input
          label="Contraseña nueva"
          type="password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          autoComplete="new-password"
          placeholder="••••••••"
          helper={`Mínimo ${MIN_PASSWORD} caracteres.`}
          required
        />
        <Input
          label="Repetir contraseña nueva"
          type="password"
          value={repetir}
          onChange={(e) => setRepetir(e.target.value)}
          autoComplete="new-password"
          placeholder="••••••••"
          required
        />
        {/* Redacción deliberada: "tendrán que volver a entrar", no "se cierran
            al instante". La sesión se revoca de inmediato, pero el token que ya
            tenga ese dispositivo vale hasta 1 h (ver `cambiarPassword`). */}
        <p className="text-[13px] text-text-muted">
          Al guardarla, los demás dispositivos donde hayas entrado tendrán que
          volver a hacerlo. Esta sesión se mantiene abierta.
        </p>
      </div>
    </Overlay>
  );
}
