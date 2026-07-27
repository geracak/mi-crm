import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { createAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { normalizarEmail } from "./emailUtils";

// ⚠️ GER-238: no volver a correr `sembrarUsuarios` ni `resetearPasswords` contra
// producción sin revisar antes el riesgo de duplicado — ambas buscan a Marta y
// Carlos por email hardcodeado (decisión Diferida, ver la issue).
//
// ⚠️ GER-239: el correo de Marta pasó a ser el real (`gera.cak@gmail.com`) para
// que la recuperación de contraseña pueda entregarle el código. Es el mismo
// valor al que `authMaintenance:migrarIdentificadorPassword` mueve su
// `providerAccountId`.
//
// La idempotencia ya NO se decide mirando `users.email`: se mira la tabla de
// credenciales (`authAccounts.providerAccountId`), que es el campo por el que el
// login identifica la cuenta. Con la comprobación anterior, un entorno todavía
// sin migrar (donde `users.email` sigue siendo el `.local`) no encontraba a
// Marta por su correo nuevo y creaba una SEGUNDA Marta. Por eso se busca por el
// correo actual y por el heredado.
//
// Carlos sigue en `carlos@vibecrm.local`, un dominio SIN buzón: hoy no puede
// recuperar contraseña. Pendiente de decisión de Gerardo (fuera de GER-239).

/** Correo heredado de Marta, anterior a GER-239. Solo para reconocerla. */
const MARTA_EMAIL_HEREDADO = "marta@vibecrm.local";

const CUENTAS = [
  {
    email: "gera.cak@gmail.com",
    heredados: [MARTA_EMAIL_HEREDADO],
    name: "Marta López",
    rol: "propietaria" as const,
  },
  {
    email: "carlos@vibecrm.local",
    heredados: [] as string[],
    name: "Carlos Ruiz",
    rol: "comercial" as const,
  },
];

/**
 * Busca la cuenta de contraseña de una persona probando varios correos (el
 * actual y los heredados). Consulta `authAccounts`, NO `users.email`: es el
 * campo por el que se identifica la credencial, y el único que responde de
 * verdad a "¿ya existe esta cuenta?".
 *
 * Devuelve el `providerAccountId` REAL encontrado, para poder operar sobre la
 * credencial que existe aunque el entorno aún no esté migrado.
 */
export const buscarCuentaPassword = internalQuery({
  args: { emails: v.array(v.string()) },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      providerAccountId: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    for (const email of args.emails) {
      const cuenta = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "password").eq("providerAccountId", normalizarEmail(email)),
        )
        .first();
      if (cuenta !== null) {
        return {
          userId: cuenta.userId,
          providerAccountId: cuenta.providerAccountId,
        };
      }
    }
    return null;
  },
});

/**
 * Seed dev-only de los usuarios del negocio. NO es invocable desde el cliente
 * (internalAction). Idempotente. El `rol` solo se produce por este camino
 * (createAccount con profile.rol → createOrUpdateUser lo acepta).
 *
 * Ejecutar en local:
 *   npx convex run seed:sembrarUsuarios '{"martaPassword":"...","carlosPassword":"..."}'
 */
export const sembrarUsuarios = internalAction({
  args: { martaPassword: v.string(), carlosPassword: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const passwords: Record<string, string> = {
      propietaria: args.martaPassword,
      comercial: args.carlosPassword,
    };
    const resultado: string[] = [];
    for (const c of CUENTAS) {
      const existente = await ctx.runQuery(internal.seed.buscarCuentaPassword, {
        emails: [c.email, ...c.heredados],
      });
      if (existente !== null) {
        resultado.push(`ya existe: ${existente.providerAccountId}`);
        continue;
      }
      await createAccount<DataModel>(ctx, {
        provider: "password",
        account: { id: c.email, secret: passwords[c.rol] },
        profile: { email: c.email, name: c.name, rol: c.rol },
      });
      resultado.push(`creado: ${c.email} (${c.rol})`);
    }
    return resultado;
  },
});

/**
 * Dev-only: fija la contraseña de los dos usuarios del negocio a la indicada.
 * Si la cuenta ya existe, resetea su credencial (modifyAccountCredentials)
 * usando el `providerAccountId` REAL — que puede ser el heredado si el entorno
 * todavía no pasó por `migrarIdentificadorPassword`. Si no existe, la crea con
 * su rol. Idempotente y re-ejecutable. NO invocable desde el cliente.
 *
 * Ejecutar en local:
 *   npx convex run seed:resetearPasswords '{"password":"..."}'
 */
export const resetearPasswords = internalAction({
  args: { password: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const resultado: string[] = [];
    for (const c of CUENTAS) {
      const existente = await ctx.runQuery(internal.seed.buscarCuentaPassword, {
        emails: [c.email, ...c.heredados],
      });
      if (existente !== null) {
        await modifyAccountCredentials<DataModel>(ctx, {
          provider: "password",
          // El id real, no `c.email`: en un entorno sin migrar son distintos y
          // usar el nuevo no encontraría la credencial.
          account: { id: existente.providerAccountId, secret: args.password },
        });
        resultado.push(`password reseteada: ${existente.providerAccountId}`);
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
