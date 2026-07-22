import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { createAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

/** Busca un usuario por email (uso interno del seed, para idempotencia). */
export const buscarPorEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, args) => {
    const u = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    return u === null ? null : u._id;
  },
});

/**
 * Seed dev-only de los usuarios del negocio. NO es invocable desde el cliente
 * (internalAction). Idempotente por email. El `rol` solo se produce por este
 * camino (createAccount con profile.rol → createOrUpdateUser lo acepta).
 *
 * Ejecutar en local:
 *   npx convex run seed:sembrarUsuarios '{"martaPassword":"...","carlosPassword":"..."}'
 */
export const sembrarUsuarios = internalAction({
  args: { martaPassword: v.string(), carlosPassword: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const cuentas = [
      {
        email: "marta@vibecrm.local",
        name: "Marta López",
        rol: "propietaria" as const,
        password: args.martaPassword,
      },
      {
        email: "carlos@vibecrm.local",
        name: "Carlos Ruiz",
        rol: "comercial" as const,
        password: args.carlosPassword,
      },
    ];
    const resultado: string[] = [];
    for (const c of cuentas) {
      const existente = await ctx.runQuery(internal.seed.buscarPorEmail, {
        email: c.email,
      });
      if (existente !== null) {
        resultado.push(`ya existe: ${c.email}`);
        continue;
      }
      await createAccount<DataModel>(ctx, {
        provider: "password",
        account: { id: c.email, secret: c.password },
        profile: { email: c.email, name: c.name, rol: c.rol },
      });
      resultado.push(`creado: ${c.email} (${c.rol})`);
    }
    return resultado;
  },
});

/**
 * Dev-only: fija la contraseña de los dos usuarios del negocio a la indicada.
 * Si el usuario ya existe, resetea su credencial (modifyAccountCredentials);
 * si no existe, lo crea con su rol (createAccount). Idempotente y re-ejecutable.
 * NO invocable desde el cliente (internalAction).
 *
 * Ejecutar en local:
 *   npx convex run seed:resetearPasswords '{"password":"..."}'
 */
export const resetearPasswords = internalAction({
  args: { password: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const cuentas = [
      {
        email: "marta@vibecrm.local",
        name: "Marta López",
        rol: "propietaria" as const,
      },
      {
        email: "carlos@vibecrm.local",
        name: "Carlos Ruiz",
        rol: "comercial" as const,
      },
    ];
    const resultado: string[] = [];
    for (const c of cuentas) {
      const existente = await ctx.runQuery(internal.seed.buscarPorEmail, {
        email: c.email,
      });
      if (existente !== null) {
        await modifyAccountCredentials<DataModel>(ctx, {
          provider: "password",
          account: { id: c.email, secret: args.password },
        });
        resultado.push(`password reseteada: ${c.email}`);
      } else {
        await createAccount<DataModel>(ctx, {
          provider: "password",
          account: { id: c.email, secret: args.password },
          profile: { email: c.email, name: c.name, rol: c.rol },
        });
        resultado.push(`creado: ${c.email} (${c.rol})`);
      }
    }
    return resultado;
  },
});
