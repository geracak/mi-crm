"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { AlertCircle, ShieldAlert } from "lucide-react";
import { api, type Id } from "@/lib/convexApi";
import { mensajeError } from "@/lib/errores";
import { ROLES, type Rol } from "@/lib/roles";
import { Overlay } from "@/components/ui/Overlay";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ChipGroup } from "@/components/ui/ChipGroup";

interface Props {
  usuario: {
    _id: Id<"users">;
    name?: string;
    email?: string;
    rol: Rol;
  };
  /** Cuántas dueñas hay ahora mismo, para no dejar el equipo sin ninguna. */
  propietariasCount: number;
  onClose: () => void;
  onGuardado: () => void;
}

/**
 * Edita a una persona del equipo (F18). El `useState` perezoso precarga los
 * datos actuales sin sincronizar estado en un efecto — el overlay se monta solo
 * al abrirlo (mismo patrón que `EditarClienteOverlay`).
 *
 * Cambiar el correo tiene consecuencias que la persona editada notará: se le
 * cierra la sesión y se desvincula su Google anterior. Por eso el aviso.
 */
export function EditarUsuarioOverlay({
  usuario,
  propietariasCount,
  onClose,
  onGuardado,
}: Props) {
  const actualizar = useAction(api.usuarios.actualizar);
  const [nombre, setNombre] = useState(() => usuario.name ?? "");
  const [email, setEmail] = useState(() => usuario.email ?? "");
  const [rol, setRol] = useState<Rol>(() => usuario.rol);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Si es la única dueña, no se le puede quitar el rol. El backend lo rechaza
  // igual; esto solo evita ofrecer una opción que va a fallar.
  const esUnicaPropietaria =
    usuario.rol === "propietaria" && propietariasCount <= 1;

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
      await actualizar({
        id: usuario._id,
        nombre: nombre.trim(),
        email: email.trim(),
        rol,
      });
      onGuardado();
      onClose();
    } catch (e) {
      setError(mensajeError(e, "No se pudo guardar. Revisa los datos."));
      setGuardando(false);
    }
  }

  return (
    <Overlay
      open
      onClose={onClose}
      title="Editar usuario"
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
        <Input
          label="Correo"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          helper={
            email.trim() !== (usuario.email ?? "")
              ? "Al cambiar el correo se cierra su sesión y tendrá que volver a entrar."
              : undefined
          }
        />
        <ChipGroup<Rol>
          label="Rol"
          options={ROLES}
          value={rol}
          onChange={(v) => v && setRol(v)}
          disabledValues={esUnicaPropietaria ? ["comercial"] : undefined}
        />
        {esUnicaPropietaria && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[13px] text-text-muted">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            Es la única dueña del CRM: no se le puede cambiar el rol. Nombrá a
            otra dueña primero.
          </div>
        )}
      </div>
    </Overlay>
  );
}
