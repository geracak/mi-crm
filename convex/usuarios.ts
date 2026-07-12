import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUsuario } from "./authz";

const ROL = v.union(v.literal("propietaria"), v.literal("comercial"));

/** El usuario de la sesión actual (para la cabecera, autoría, etc.). */
export const actual = query({
  args: {},
  returns: v.object({
    _id: v.id("users"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    rol: ROL,
  }),
  handler: async (ctx) => {
    const u = await requireUsuario(ctx);
    return { _id: u._id, name: u.name, email: u.email, rol: u.rol! };
  },
});

/** Usuarios provisionados del negocio, para el selector de responsable (TAL-15). */
export const listar = query({
  args: {},
  returns: v.array(
    v.object({ _id: v.id("users"), name: v.optional(v.string()), rol: ROL }),
  ),
  handler: async (ctx) => {
    await requireUsuario(ctx);
    const todos = await ctx.db.query("users").collect();
    return todos
      .filter((u) => u.rol === "propietaria" || u.rol === "comercial")
      .map((u) => ({ _id: u._id, name: u.name, rol: u.rol! }));
  },
});
