import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    rol: v.union(v.literal("propietaria"), v.literal("comercial")),
    isDemo: v.optional(v.boolean()),
  }).index("by_email", ["email"]),

  clientes: defineTable({
    nombre: v.string(),
    empresa: v.optional(v.string()),
    telefono: v.optional(v.string()),
    email: v.optional(v.string()),
    canalOrigen: v.optional(v.string()),
    estado: v.string(),
    ultimoContacto: v.optional(v.number()),
    isDemo: v.optional(v.boolean()),
  }),

  seguimientos: defineTable({
    clienteId: v.id("clientes"),
    accion: v.string(),
    vence: v.number(),
    hecho: v.boolean(),
    fechaHecho: v.optional(v.number()),
    responsableId: v.id("users"),
    isDemo: v.optional(v.boolean()),
  })
    .index("by_hecho_vence", ["hecho", "vence"])
    .index("by_cliente", ["clienteId"]),
});
