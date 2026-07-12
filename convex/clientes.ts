import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// El string de la ruta /clientes/[id] es un valor arbitrario que puede venir
// de una URL escrita a mano - nunca confiar en que sea un Id<"clientes">
// válido solo porque TypeScript lo tipa así en el resto del código.
export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    let doc;
    try {
      doc = await ctx.db.get(id as Id<"clientes">);
    } catch {
      return null;
    }
    if (!doc) return null;
    return doc;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("clientes").collect();
  },
});
