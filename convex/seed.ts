import { v, ConvexError } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { createAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

// ⚠️ GER-238: no volver a correr `sembrarUsuarios` ni `resetearPasswords` contra
// producción sin revisar antes el riesgo de duplicado — ambas buscan a Marta y
// Carlos por email hardcodeado (`marta@vibecrm.local`/`carlos@vibecrm.local`),
// que puede no coincidir con `users.email` si esa cuenta cambió de email tras
// vincularse con Google (decisión Diferida, ver la issue).

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

/**
 * GER-238 — parche de datos PUNTUAL, se retira de este archivo en un commit
 * separado apenas se confirme que corrió bien. Reasigna el email de un
 * usuario YA provisionado (no crea, no borra). Uso único: vincular a Marta
 * (propietaria) con el Gmail personal de Gerardo para poder probar el login
 * con Google de punta a punta. No toca `authAccounts`: el login por
 * contraseña sigue funcionando con el email original, porque
 * `@convex-dev/auth` busca la cuenta password por
 * `authAccounts.providerAccountId`, no por `users.email`.
 *
 * Ejecutar (contra producción, por decisión explícita — ver GER-238):
 *   npx convex run seed:actualizarEmailUsuario \
 *     '{"emailActual":"marta@vibecrm.local","emailNuevo":"gera.cak@gmail.com"}' --prod
 */
export const actualizarEmailUsuario = internalMutation({
  args: { emailActual: v.string(), emailNuevo: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const usuario = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.emailActual))
      .unique();
    if (usuario === null) {
      throw new ConvexError(`No existe usuario con email ${args.emailActual}`);
    }
    const colision = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.emailNuevo))
      .unique();
    if (colision !== null && colision._id !== usuario._id) {
      throw new ConvexError(`Ya hay otro usuario con email ${args.emailNuevo}`);
    }
    await ctx.db.patch(usuario._id, { email: args.emailNuevo });
    return `email actualizado: ${args.emailActual} -> ${args.emailNuevo} (rol ${usuario.rol})`;
  },
});
