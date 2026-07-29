"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { AlertCircle, Info } from "lucide-react";
import { api } from "@/lib/convexApi";
import { mensajeError } from "@/lib/errores";
import { ROLES, type Rol } from "@/lib/roles";
import { Overlay } from "@/components/ui/Overlay";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ChipGroup } from "@/components/ui/ChipGroup";

interface Props {
  onClose: () => void;
  /** `emailEnviado` decide el texto del toast: el alta vale igual si falla el correo. */
  onInvitado: (emailEnviado: boolean) => void;
}

/**
 * Alta de una persona del equipo (F18). No pide contraseña a propósito: la
 * cuenta se crea con una aleatoria que nadie ve y la persona elige la suya con
 * el código que le llega por correo.
 *
 * Se monta solo al abrirlo, así el estado arranca limpio en cada alta.
 */
export function NuevoUsuarioOverlay({ onClose, onInvitado }: Props) {
  const invitar = useAction(api.usuarios.invitar);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  // Por defecto el rol de menor privilegio: que "dueña" sea siempre deliberado.
  const [rol, setRol] = useState<Rol>("comercial");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setError(null);
    if (!nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    if (!email.trim()) {
      setError("El correo es obligatorio.");
      return;
    }
    setGuardando(true);
    try {
      const { emailEnviado } = await invitar({
        nombre: nombre.trim(),
        email: email.trim(),
        rol,
      });
      onInvitado(emailEnviado);
      onClose();
    } catch (e) {
      setError(mensajeError(e, "No se pudo dar de alta. Revisa los datos."));
      setGuardando(false);
    }
  }

  return (
    <Overlay
      open
      onClose={onClose}
      title="Añadir usuario"
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
            Enviar invitación
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
        <Input
          label="Correo"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <ChipGroup<Rol>
          label="Rol"
          options={ROLES}
          value={rol}
          // Siempre hay un rol elegido: pulsar el activo no lo deselecciona.
          onChange={(v) => v && setRol(v)}
        />
        <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[13px] text-text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Le enviamos un correo para que cree su contraseña. No hace falta que
          le pases ninguna clave.
        </div>
      </div>
    </Overlay>
  );
}
