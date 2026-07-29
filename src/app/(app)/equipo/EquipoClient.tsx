"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { type Id } from "@/lib/convexApi";
import { api } from "@/lib/convexApi";
import { ROL_BADGE, ROL_LABEL, type Rol } from "@/lib/roles";
import { useUsuarioActual } from "@/lib/useSesion";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconButton } from "@/components/ui/IconButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { Toast } from "@/components/ui/Toast";
import { NuevoUsuarioOverlay } from "@/components/overlays/NuevoUsuarioOverlay";
import { EditarUsuarioOverlay } from "@/components/overlays/EditarUsuarioOverlay";
import { EliminarUsuarioOverlay } from "@/components/overlays/EliminarUsuarioOverlay";

type Persona = {
  _id: Id<"users">;
  name?: string;
  email?: string;
  rol: Rol;
};

function ListaSkeleton() {
  return (
    <Card padding="none" className="overflow-hidden">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border px-4.5 py-3.5 last:border-b-0"
        >
          <Skeleton width={40} height={40} radius={9999} />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton width="38%" height={13} />
            <Skeleton width="52%" height={11} />
          </div>
          <Skeleton width={96} height={26} radius={9999} />
        </div>
      ))}
    </Card>
  );
}

/**
 * Gestión de usuarios y roles (F18 / GER-219). Solo la ve la dueña: el gate real
 * está server-side en `page.tsx` y en cada función de Convex.
 *
 * `propietariasCount` se calcula sobre la MISMA lista que se pinta, así lo que
 * decide si un botón aparece nunca puede discrepar de lo que hay en pantalla.
 */
export function EquipoClient() {
  const { isAuthenticated } = useConvexAuth();
  const equipo = useQuery(api.usuarios.equipo, isAuthenticated ? {} : "skip") as
    | Persona[]
    | undefined;
  const yo = useUsuarioActual();

  const [nuevo, setNuevo] = useState(false);
  const [editando, setEditando] = useState<Persona | null>(null);
  const [eliminando, setEliminando] = useState<Persona | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const personas = equipo ?? [];
  const propietariasCount = personas.filter(
    (p) => p.rol === "propietaria",
  ).length;

  /**
   * Quién puede ser eliminado. Mientras no sepamos quién soy yo (`yo` llega
   * `undefined` en la primera carga) NO se ofrece eliminar a nadie: enseñar el
   * botón un instante en la propia fila sería justo el caso que hay que evitar.
   */
  function puedeEliminar(p: Persona): boolean {
    if (yo === undefined) return false;
    if (p._id === yo._id) return false;
    return !(p.rol === "propietaria" && propietariasCount <= 1);
  }

  return (
    <div className="flex flex-col gap-4 pb-24 md:pb-0">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-text-subtle">
            Gestión del equipo
          </p>
          <h1 className="text-2xl font-semibold text-text">
            Quién tiene acceso
          </h1>
        </div>
        <Button
          size="compact"
          iconLeft={<Plus className="size-4" aria-hidden />}
          className="shrink-0"
          onClick={() => setNuevo(true)}
        >
          Añadir usuario
        </Button>
      </div>

      {equipo === undefined ? (
        <ListaSkeleton />
      ) : personas.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={<Users className="size-6" aria-hidden />}
            title="Todavía no hay nadie en el equipo"
            help="Añadí a las personas que van a usar el CRM y elegí su rol."
            action={
              <Button size="compact" onClick={() => setNuevo(true)}>
                Añadir usuario
              </Button>
            }
          />
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          {personas.map((p) => (
            <div
              key={p._id}
              className="flex items-center gap-3 border-b border-border px-4.5 py-3.5 last:border-b-0"
            >
              <Avatar
                name={p.name ?? p.email ?? "?"}
                variant={p.rol === "propietaria" ? "primary" : "neutral"}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-medium text-text">
                  {p.name ?? "Sin nombre"}
                  {yo !== undefined && p._id === yo._id && (
                    <span className="ml-1.5 text-[13px] font-normal text-text-subtle">
                      (vos)
                    </span>
                  )}
                </span>
                <span className="truncate text-[13px] text-text-muted">
                  {p.email ?? "Sin correo"}
                </span>
              </div>
              <Badge status={ROL_BADGE[p.rol]} className="hidden shrink-0 sm:inline-flex">
                {ROL_LABEL[p.rol]}
              </Badge>
              <IconButton
                size="compact"
                aria-label={`Editar a ${p.name ?? p.email ?? "esta persona"}`}
                onClick={() => setEditando(p)}
              >
                <Pencil className="size-[18px]" aria-hidden />
              </IconButton>
              {puedeEliminar(p) && (
                <IconButton
                  size="compact"
                  variant="destructive"
                  aria-label={`Eliminar a ${p.name ?? p.email ?? "esta persona"}`}
                  onClick={() => setEliminando(p)}
                >
                  <Trash2 className="size-[18px]" aria-hidden />
                </IconButton>
              )}
            </div>
          ))}
        </Card>
      )}

      {/* Montados solo al abrirlos: así cada overlay arranca con estado limpio. */}
      {nuevo && (
        <NuevoUsuarioOverlay
          onClose={() => setNuevo(false)}
          onInvitado={(emailEnviado) =>
            setToast(
              emailEnviado
                ? "Invitación enviada"
                : "Usuario añadido, pero no pudimos enviar el correo",
            )
          }
        />
      )}

      {editando && (
        <EditarUsuarioOverlay
          usuario={editando}
          propietariasCount={propietariasCount}
          onClose={() => setEditando(null)}
          onGuardado={() => setToast("Usuario actualizado")}
        />
      )}

      {eliminando && (
        <EliminarUsuarioOverlay
          usuario={eliminando}
          onClose={() => setEliminando(null)}
          onEliminado={() => setToast("Acceso eliminado")}
        />
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
