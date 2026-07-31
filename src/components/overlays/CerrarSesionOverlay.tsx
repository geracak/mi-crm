"use client";

import { useState } from "react";
import { useCerrarSesion } from "@/lib/useSesion";
import { Overlay } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";

interface Props {
  onClose: () => void;
}

/**
 * GER-218 — Confirmación de "cerrar sesión", compartida por el `Sidebar` (donde
 * vivía suelta) y por `/cuenta`. Se extrajo al añadir el segundo sitio que la
 * necesita: en móvil el Sidebar es `hidden md:flex`, así que hasta ahora no
 * había ninguna forma de cerrar sesión desde el teléfono.
 *
 * No hay un `ConfirmDialog` genérico en el proyecto: los diálogos se componen
 * sobre `Overlay`, como en `EliminarUsuarioOverlay`.
 */
export function CerrarSesionOverlay({ onClose }: Props) {
  const cerrarSesion = useCerrarSesion();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    await cerrarSesion();
  }

  return (
    <Overlay
      open
      onClose={onClose}
      title="Cerrar sesión"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="compact"
            onClick={onClose}
            disabled={saliendo}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            size="compact"
            loading={saliendo}
            onClick={salir}
          >
            Cerrar sesión
          </Button>
        </div>
      }
    >
      <p className="text-[15px] text-text-muted">
        ¿Seguro que quieres cerrar sesión?
      </p>
    </Overlay>
  );
}
