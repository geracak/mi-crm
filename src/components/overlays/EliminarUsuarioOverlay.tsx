"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { AlertCircle } from "lucide-react";
import { api, type Id } from "@/lib/convexApi";
import { mensajeError } from "@/lib/errores";
import { Overlay } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";

interface Props {
  usuario: { _id: Id<"users">; name?: string; email?: string };
  onClose: () => void;
  onEliminado: () => void;
}

/**
 * Confirmación de quitar el acceso a alguien (F18). No hay un `ConfirmDialog`
 * genérico en el repo y no se crea uno para un solo caso: se compone sobre
 * `Overlay`, que ya trae foco atrapado, Esc y `role="dialog"`.
 *
 * Las dos reglas duras (no eliminarse a una misma, no dejar el equipo sin
 * ninguna dueña) se aplican antes: quien no puede ser eliminado no llega acá
 * porque no se le muestra el botón. El backend las revalida igual.
 */
export function EliminarUsuarioOverlay({
  usuario,
  onClose,
  onEliminado,
}: Props) {
  const eliminar = useAction(api.usuarios.eliminar);
  const [error, setError] = useState<string | null>(null);
  const [eliminando, setEliminando] = useState(false);

  async function confirmar() {
    setError(null);
    setEliminando(true);
    try {
      await eliminar({ id: usuario._id });
      onEliminado();
      onClose();
    } catch (e) {
      setError(mensajeError(e, "No se pudo quitar el acceso."));
      setEliminando(false);
    }
  }

  const quien = usuario.name ?? usuario.email ?? "esta persona";

  return (
    <Overlay
      open
      onClose={onClose}
      title="Eliminar usuario"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="compact"
            onClick={onClose}
            disabled={eliminando}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            size="compact"
            loading={eliminando}
            onClick={confirmar}
          >
            Sí, quitar acceso
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-md border border-error bg-error-bg px-3 py-2.5 text-[13px] text-error-text"
          >
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            {error}
          </div>
        )}
        <p className="text-[15px] text-text">
          ¿Seguro que querés quitarle el acceso a{" "}
          <span className="font-semibold">{quien}</span>?
        </p>
        <p className="text-[13px] text-text-muted">
          Se cierra su sesión al instante y no va a poder volver a entrar. Los
          clientes, ventas e interacciones que haya cargado se mantienen, y sus
          seguimientos pendientes pasan a estar a tu nombre para que no queden
          sin dueño.
        </p>
      </div>
    </Overlay>
  );
}
