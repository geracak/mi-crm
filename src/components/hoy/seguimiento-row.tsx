"use client";

import { useRouter } from "next/navigation";
import { CheckboxRound } from "@/components/ui/checkbox-round";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { relativeDueLabel } from "@/lib/date";
import type { SeguimientoConRelaciones } from "@/components/hoy/types";

interface SeguimientoRowProps {
  seguimiento: SeguimientoConRelaciones;
  overdue?: boolean;
  onMarcarHecho: () => void;
}

export function SeguimientoRow({ seguimiento, overdue = false, onMarcarHecho }: SeguimientoRowProps) {
  const router = useRouter();

  return (
    <div
      onClick={() => router.push(`/clientes/${seguimiento.clienteId}`)}
      className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-2"
    >
      <CheckboxRound
        checked={seguimiento.hecho}
        onChange={onMarcarHecho}
        aria-label={`Marcar "${seguimiento.accion}" como hecho`}
      />
      <span className="hidden sm:block">
        <Avatar name={seguimiento.cliente?.nombre ?? "?"} size={36} variant="neutral" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-medium text-text">
            {seguimiento.cliente?.nombre ?? "Cliente"}
          </span>
          {seguimiento.cliente?.estado && (
            <span className="hidden shrink-0 sm:block">
              <Badge status="neutral" dot={false}>
                {seguimiento.cliente.estado}
              </Badge>
            </span>
          )}
        </div>
        <span className="truncate text-[13px] text-text-muted">{seguimiento.accion}</span>
      </div>
      {seguimiento.responsable && (
        <span className="hidden sm:block">
          <Avatar name={seguimiento.responsable.name} size={28} />
        </span>
      )}
      <span
        className={
          "shrink-0 whitespace-nowrap text-[13px] " +
          (overdue ? "font-medium text-error" : "text-text-muted")
        }
      >
        {relativeDueLabel(seguimiento.vence)}
      </span>
    </div>
  );
}
