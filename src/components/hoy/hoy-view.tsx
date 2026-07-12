"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarClock } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Overlay } from "@/components/shell/overlay";
import { useToast } from "@/components/ui/toast";
import { QuickActions, type QuickActionId } from "@/components/hoy/quick-actions";
import { SeguimientoSection } from "@/components/hoy/seguimiento-section";
import { SeguimientoRow } from "@/components/hoy/seguimiento-row";
import { eyebrowDate } from "@/lib/date";

const PLACEHOLDER_TITLES: Record<Exclude<QuickActionId, "nueva-tarea">, string> = {
  "anotar-interaccion": "Anotar interacción",
  "registrar-venta": "Registrar venta",
  "nuevo-cliente": "Nuevo cliente",
};

export function HoyView() {
  const pendientes = useQuery(api.seguimientos.listPendientes);
  const currentUser = useQuery(api.users.getCurrent);
  const clientes = useQuery(api.clientes.list);
  const marcarHecho = useMutation(api.seguimientos.marcarHecho);
  const deshacerHecho = useMutation(api.seguimientos.deshacerHecho);
  const crearRapida = useMutation(api.seguimientos.crearRapida);
  const { show } = useToast();

  const [activeOverlay, setActiveOverlay] = useState<QuickActionId | null>(null);
  const [nuevaAccion, setNuevaAccion] = useState("");
  const [nuevoClienteId, setNuevoClienteId] = useState("");
  const [nuevaFecha, setNuevaFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [creando, setCreando] = useState(false);

  const isLoading = pendientes === undefined;
  const totalHoy = isLoading ? 0 : pendientes.atrasados.length + pendientes.paraHoy.length;
  const totalTodas = isLoading
    ? 0
    : pendientes.atrasados.length + pendientes.paraHoy.length + pendientes.proximos.length;

  async function handleMarcarHecho(id: Id<"seguimientos">) {
    await marcarHecho({ id });
    show("Seguimiento completado", { onUndo: () => deshacerHecho({ id }) });
  }

  async function handleCrearTarea() {
    if (!nuevoClienteId || !nuevaAccion.trim() || !currentUser) return;
    setCreando(true);
    try {
      await crearRapida({
        clienteId: nuevoClienteId as Id<"clientes">,
        accion: nuevaAccion,
        vence: new Date(nuevaFecha).getTime(),
        responsableId: currentUser._id,
      });
      setNuevaAccion("");
      setNuevoClienteId("");
      setActiveOverlay(null);
    } finally {
      setCreando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="mb-1 text-xs font-medium tracking-[0.06em] text-text-muted">
          {eyebrowDate(new Date())}
        </p>
        <h1 className="m-0 text-2xl font-semibold text-text">
          {isLoading ? "Cargando..." : `${totalHoy} seguimientos pendientes`}
        </h1>
      </header>

      <QuickActions onSelect={setActiveOverlay} />

      {isLoading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={64} className="rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && totalTodas === 0 && (
        <EmptyState
          icon={<CalendarClock size={24} strokeWidth={1.5} />}
          title="No hay seguimientos para hoy"
          help="Cuando programes un seguimiento o una tarea, aparecerá acá."
          action={
            <Button onClick={() => setActiveOverlay("nueva-tarea")}>Nueva tarea</Button>
          }
        />
      )}

      {!isLoading && totalTodas > 0 && (
        <>
          <SeguimientoSection title="Atrasados" count={pendientes.atrasados.length} variant="error">
            {pendientes.atrasados.map((s) => (
              <SeguimientoRow
                key={s._id}
                seguimiento={s}
                overdue
                onMarcarHecho={() => handleMarcarHecho(s._id)}
              />
            ))}
          </SeguimientoSection>

          <SeguimientoSection title="Para hoy" count={pendientes.paraHoy.length}>
            {pendientes.paraHoy.map((s) => (
              <SeguimientoRow
                key={s._id}
                seguimiento={s}
                onMarcarHecho={() => handleMarcarHecho(s._id)}
              />
            ))}
          </SeguimientoSection>

          <SeguimientoSection title="Próximas" count={pendientes.proximos.length}>
            {pendientes.proximos.map((s) => (
              <SeguimientoRow
                key={s._id}
                seguimiento={s}
                onMarcarHecho={() => handleMarcarHecho(s._id)}
              />
            ))}
          </SeguimientoSection>
        </>
      )}

      <Overlay
        open={activeOverlay === "nueva-tarea"}
        onClose={() => setActiveOverlay(null)}
        title="Nueva tarea"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="nueva-tarea-cliente" className="text-sm font-medium text-text">
              Cliente
            </label>
            <select
              id="nueva-tarea-cliente"
              value={nuevoClienteId}
              onChange={(e) => setNuevoClienteId(e.target.value)}
              className="h-12 rounded-md border border-border-strong bg-surface px-3.5 text-[15px] text-text outline-none focus:border-primary"
            >
              <option value="">Seleccionar cliente...</option>
              {clientes?.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Acción"
            placeholder="Ej: Llamar para confirmar pedido"
            value={nuevaAccion}
            onChange={(e) => setNuevaAccion(e.target.value)}
          />
          <Input
            label="Fecha"
            type="date"
            value={nuevaFecha}
            onChange={(e) => setNuevaFecha(e.target.value)}
          />
          <Button
            onClick={handleCrearTarea}
            loading={creando}
            disabled={!nuevoClienteId || !nuevaAccion.trim()}
          >
            Crear tarea
          </Button>
        </div>
      </Overlay>

      {(["anotar-interaccion", "registrar-venta", "nuevo-cliente"] as const).map((id) => (
        <Overlay
          key={id}
          open={activeOverlay === id}
          onClose={() => setActiveOverlay(null)}
          title={PLACEHOLDER_TITLES[id]}
        >
          <p className="text-sm text-text-muted">
            Formulario en construcción. Este flujo se implementa en otro ticket.
          </p>
        </Overlay>
      ))}
    </div>
  );
}
