import { query } from "./_generated/server";

// TODO(GER-217): reemplazar por sesión real. Hasta entonces, "el usuario
// actual" es siempre el único documento sembrado con este email fijo -
// nunca "el primero"/"el más reciente" de la tabla.
export const DEMO_USER_EMAIL = "marta@seed.local";

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", DEMO_USER_EMAIL))
      .unique();
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});
