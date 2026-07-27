import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { createAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

// ⚠️ GER-238: no volver a correr `sembrarUsuarios` ni `resetearPasswords` contra
// producción sin revisar antes el riesgo de duplicado — ambas buscan a Marta y
// Carlos por email hardcodeado, que puede no coincidir con `users.email` si esa
// cuenta cambió de email tras vincularse con Google (decisión Diferida, ver la
// issue).
//
// ⚠️ GER-239: el email de Marta pasó a ser el real (`gera.cak@gmail.com`) para
// que la recuperación de contraseña pueda entregarle el código. Es el mismo
// valor al que `authMaintenance:migrarIdentificadorPassword` mueve su
// `providerAccountId`: si se cambia aquí, hay que cambiarlo allí, o el seed
// volvería a crear una credencial con el identificador viejo.
// Carlos sigue en `carlos@vibecrm.local`, un dominio SIN buzón: hoy no puede
// recuperar contraseña. Pendiente de decisión de Gerardo (fuera de GER-239).

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
        email: "gera.cak@gmail.com",
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
        email: "gera.cak@gmail.com",
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
