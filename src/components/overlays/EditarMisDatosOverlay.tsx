"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { AlertCircle } from "lucide-react";
import { api } from "@/lib/convexApi";
import { mensajeError } from "@/lib/errores";
import { Overlay } from "@/components/ui/Overlay";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface Props {
  nombreActual: string;
  emailActual: string;
  onClose: () => void;
  onGuardado: () => void;
}

/**
 * GER-218 — Tus propios datos. Solo el NOMBRE se edita.
 *
 * El correo se muestra pero no se toca, y no es una limitación por pereza:
 * cambiarlo obliga a mover `authAccounts.providerAccountId`, borrar los códigos
 * pendientes, desvincular Google e invalidar sesiones (eso es
 * `usuarios:actualizar`, restringido a la dueña). Y hacerlo uno mismo sin
 * re-autenticar convertiría cualquier sesión robada en una apropiación de
 * cuenta: te mudás el correo y después pedís "olvidé mi contraseña" a tu buzón.
 *
 * `useState` perezoso para precargar sin sincronizar en un efecto: el overlay se
 * monta solo al abrirlo (mismo patrón que `EditarUsuarioOverlay`).
 */
export function EditarMisDatosOverlay({
  nombreActual,
  emailActual,
  onClose,
  onGuardado,
}: Props) {
  const actualizarNombre = useMutation(api.usuarios.actualizarNombre);
  const [nombre, setNombre] = useState(() => nombreActual);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setError(null);
    if (!nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setGuardando(true);
    try {
      await actualizarNombre({ nombre: nombre.trim() });
      onGuardado();
      onClose();
    } catch (e) {
      setError(mensajeError(e, "No se pudo guardar. Revisá los datos."));
      setGuardando(false);
    }
  }

  return (
    <Overlay
      open
      onClose={onClose}
      title="Editar mis datos"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="compact"
            onClick={onClose}
            disabled={guardando}
          >
            Cancelar
          </Button>
          <Button size="compact" loading={guardando} onClick={guardar}>
            Guardar cambios
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
        <Input
          label="Nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          autoFocus
          required
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-text">Correo</span>
          <p className="rounded-md border border-border bg-surface-2 px-3.5 py-3 text-[15px] text-text-muted">
            {emailActual || "Sin correo"}
          </p>
          <span className="text-[13px] text-text-muted">
            Tu correo es con lo que entrás al CRM. Para cambiarlo, pedíselo a la
            dueña.
          </span>
        </div>
      </div>
    </Overlay>
  );
}
