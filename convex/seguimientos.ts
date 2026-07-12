import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { todayBoundsMs } from "./dateBounds";

const MAX_PENDIENTES = 100;

async function withRelations(
  ctx: QueryCtx,
  seguimientos: Doc<"seguimientos">[],
) {
  const clienteIds = new Set(seguimientos.map((s) => s.clienteId));
  const responsableIds = new Set(seguimientos.map((s) => s.responsableId));

  const clientes = new Map(
    (
      await Promise.all([...clienteIds].map((id) => ctx.db.get(id)))
    )
      .filter((c): c is Doc<"clientes"> => c !== null)
      .map((c) => [c._id, c]),
  );
  const responsables = new Map(
    (
      await Promise.all([...responsableIds].map((id) => ctx.db.get(id)))
    )
      .filter((u): u is Doc<"users"> => u !== null)
      .map((u) => [u._id, u]),
  );

  return seguimientos.map((s) => ({
    ...s,
    cliente: clientes.get(s.clienteId) ?? null,
    responsable: responsables.get(s.responsableId) ?? null,
  }));
}

export const listPendientes = query({
  args: {},
  handler: async (ctx) => {
    // N+1 aceptado como tradeoff de MVP bajo MAX_PENDIENTES; optimizar si
    // hay volumen real (ver plan, checklist de revisión).
    const pendientes = await ctx.db
      .query("seguimientos")
      .withIndex("by_hecho_vence", (q) => q.eq("hecho", false))
      .order("asc")
      .take(MAX_PENDIENTES);

    const { startOfDayMs, endOfDayMs } = todayBoundsMs(Date.now());

    const atrasados = pendientes.filter((s) => s.vence < startOfDayMs);
    const paraHoy = pendientes.filter(
      (s) => s.vence >= startOfDayMs && s.vence <= endOfDayMs,
    );
    const proximos = pendientes.filter((s) => s.vence > endOfDayMs);

    return {
      atrasados: await withRelations(ctx, atrasados),
      paraHoy: await withRelations(ctx, paraHoy),
      proximos: await withRelations(ctx, proximos),
    };
  },
});

export const marcarHecho = mutation({
  args: { id: v.id("seguimientos") },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id);
    if (!doc) throw new Error("Seguimiento no encontrado");
    if (doc.hecho) return; // idempotente: ya estaba hecho, no-op
    await ctx.db.patch(id, { hecho: true, fechaHecho: Date.now() });
  },
});

export const deshacerHecho = mutation({
  args: { id: v.id("seguimientos") },
  handler: async (ctx, { id }) => {
    // TODO(GER-217): autorización - hoy cualquiera puede deshacer cualquier
    // seguimiento completado porque no hay sesión real todavía.
    const doc = await ctx.db.get(id);
    if (!doc) throw new Error("Seguimiento no encontrado");
    if (!doc.hecho) return; // idempotente
    await ctx.db.patch(id, { hecho: false, fechaHecho: undefined });
  },
});

export const crearRapida = mutation({
  args: {
    clienteId: v.id("clientes"),
    accion: v.string(),
    vence: v.number(),
    responsableId: v.id("users"),
  },
  handler: async (ctx, { clienteId, accion, vence, responsableId }) => {
    const accionTrim = accion.trim();
    if (accionTrim.length === 0) {
      throw new Error("La acción no puede estar vacía");
    }
    const cliente = await ctx.db.get(clienteId);
    if (!cliente) throw new Error("Cliente no encontrado");
    const responsable = await ctx.db.get(responsableId);
    if (!responsable) throw new Error("Responsable no encontrado");

    return await ctx.db.insert("seguimientos", {
      clienteId,
      accion: accionTrim,
      vence,
      hecho: false,
      responsableId,
    });
  },
});
