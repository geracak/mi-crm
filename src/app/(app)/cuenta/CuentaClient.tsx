"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Lock, LogOut, Pencil } from "lucide-react";
import { ROL_BADGE, ROL_LABEL } from "@/lib/roles";
import { useUsuarioActual } from "@/lib/useSesion";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Toast } from "@/components/ui/Toast";
import { EditarMisDatosOverlay } from "@/components/overlays/EditarMisDatosOverlay";
import { CambiarPasswordOverlay } from "@/components/overlays/CambiarPasswordOverlay";
import { CerrarSesionOverlay } from "@/components/overlays/CerrarSesionOverlay";

type Cual = "datos" | "password" | "salir";

function CabeceraSkeleton() {
  return (
    <Card>
      <div className="flex items-center gap-4">
        <Skeleton width={56} height={56} radius={9999} />
        <div className="flex flex-1 flex-col gap-2.5">
          <Skeleton width="44%" height={16} />
          <Skeleton width={104} height={24} radius={9999} />
        </div>
      </div>
    </Card>
  );
}

/**
 * GER-218 — Perfil / Mi cuenta.
 *
 * Se entra por el avatar (Sidebar en escritorio, cabecera en móvil), no por una
 * pestaña: es una pantalla "push" y por eso `esPantallaPush` le quita la barra
 * inferior y le pone botón atrás.
 *
 * En móvil este es además el ÚNICO sitio desde donde se puede cerrar sesión: el
 * botón del Sidebar es `hidden md:flex`.
 */
export function CuentaClient() {
  const yo = useUsuarioActual();
  const [overlay, setOverlay] = useState<Cual | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Mismo patrón de toast que /equipo: estado local y temporizador propio, que
  // es lo que hay en este proyecto (no existe un provider de toasts).
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const filas = [
    {
      cual: "datos" as const,
      icono: <Pencil className="size-[18px]" aria-hidden />,
      texto: "Editar mis datos",
    },
    {
      cual: "password" as const,
      icono: <Lock className="size-[18px]" aria-hidden />,
      texto: "Cambiar contraseña",
    },
  ];

  return (
    <div className="flex flex-col gap-4 pb-24 md:pb-0">
      {yo === undefined ? (
        <CabeceraSkeleton />
      ) : (
        <Card>
          <div className="flex items-center gap-4">
            <Avatar
              name={yo.name ?? yo.email ?? "?"}
              variant={yo.rol === "propietaria" ? "primary" : "neutral"}
              size={56}
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="truncate text-[19px] font-semibold text-text">
                {yo.name ?? "Sin nombre"}
              </span>
              <span className="truncate text-[13px] text-text-muted">
                {yo.email ?? "Sin correo"}
              </span>
              <Badge status={ROL_BADGE[yo.rol]} className="self-start">
                {ROL_LABEL[yo.rol]}
              </Badge>
            </div>
          </div>
        </Card>
      )}

      <Card padding="none" className="overflow-hidden">
        {filas.map((fila) => (
          <button
            key={fila.cual}
            type="button"
            // Hasta saber quién soy no se puede precargar el formulario con mis
            // datos, así que las opciones no se ofrecen todavía.
            disabled={yo === undefined}
            onClick={() => setOverlay(fila.cual)}
            className="flex w-full items-center gap-3 border-b border-border px-4.5 py-3.5 text-left text-[15px] text-text last:border-b-0 hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-text-subtle"
          >
            <span className="shrink-0 text-text-subtle">{fila.icono}</span>
            <span className="min-w-0 flex-1">{fila.texto}</span>
            <ChevronRight
              className="size-[18px] shrink-0 text-text-subtle"
              aria-hidden
            />
          </button>
        ))}
      </Card>

      <button
        type="button"
        onClick={() => setOverlay("salir")}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-border-strong bg-surface text-[15px] font-semibold text-error-text hover:bg-error-bg"
      >
        <LogOut className="size-[18px]" aria-hidden />
        Cerrar sesión
      </button>

      {/* Montados solo al abrirlos: cada overlay arranca con estado limpio. */}
      {overlay === "datos" && yo !== undefined && (
        <EditarMisDatosOverlay
          nombreActual={yo.name ?? ""}
          emailActual={yo.email ?? ""}
          onClose={() => setOverlay(null)}
          onGuardado={() => setToast("Datos actualizados")}
        />
      )}

      {overlay === "password" && (
        <CambiarPasswordOverlay
          onClose={() => setOverlay(null)}
          onCambiada={() => setToast("Contraseña actualizada")}
        />
      )}

      {overlay === "salir" && (
        <CerrarSesionOverlay onClose={() => setOverlay(null)} />
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
