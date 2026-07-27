import { v, ConvexError } from "convex/values";
import { internalMutation } from "./_generated/server";
import { normalizarEmail } from "./emailUtils";

const UNA_HORA_MS = 60 * 60 * 1000;

// GER-238: `authVerifiers` (@convex-dev/auth) no tiene `expirationTime` propio
// (dist/server/implementation/types.js) y la librería solo lo borra si el
// login OAuth se completa con éxito (dist/.../mutations/userOAuth.js) — un
// rechazo de nuestro `createOrUpdateUser` (registro cerrado) deja la fila
// huérfana para siempre. Este cron limpia los que superan 1h (el flujo real
// de OAuth tarda segundos). Límite de `take(200)` por corrida: suficiente
// para el volumen de este CRM (2 usuarios); revisar solo si hay abuso real.
export const limpiarVerifiersHuerfanos = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const corte = Date.now() - UNA_HORA_MS;
    const filas = await ctx.db.query("authVerifiers").order("asc").take(200);
    for (const fila of filas) {
      if (fila._creationTime < corte) {
        await ctx.db.delete(fila._id);
      }
    }
    return null;
  },
});

/**
 * GER-239 — Alinea el identificador de la cuenta de contraseña con el correo
 * real, conservando el hash de la contraseña (no fuerza cambiarla).
 *
 * Por qué hace falta: el login por contraseña identifica la cuenta por
 * `authAccounts.providerAccountId`, NO por `users.email`. En producción Marta
 * tenía `users.email = gera.cak@gmail.com` (por donde entra con Google) pero
 * `providerAccountId = marta@vibecrm.local`. Sin alinearlos, pedir el código
 * con el correo real no encuentra cuenta, y pedirlo con el `.local` lo manda a
 * un dominio sin buzón.
 *
 * ⚠️ `providerAndAccountId` NO es un índice único — Convex no los tiene. Toda
 * la protección contra duplicados es explícita, de ahí las guardas de abajo.
 *
 * Ejecutar en local:
 *   npx convex run authMaintenance:migrarIdentificadorPassword \
 *     '{"emailActual":"marta@vibecrm.local","emailNuevo":"gera.cak@gmail.com"}'
 */
export const migrarIdentificadorPassword = internalMutation({
  args: { emailActual: v.string(), emailNuevo: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const origen = normalizarEmail(args.emailActual);
    const destino = normalizarEmail(args.emailNuevo);

    // Guarda 1 — un destino inválido dejaría la cuenta inaccesible.
    if (destino === "" || !destino.includes("@") || destino.endsWith(".local")) {
      throw new ConvexError(
        `Destino inválido: "${args.emailNuevo}". Debe ser un correo real (no vacío, con "@" y fuera de .local).`,
      );
    }
    if (origen === destino) {
      return `Sin cambios: origen y destino son el mismo correo (${destino}).`;
    }

    const cuentasOrigen = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", origen),
      )
      .take(2);
    const cuentasDestino = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", destino),
      )
      .take(2);

    // Guarda 2 — más de una cuenta con el mismo identificador: situación
    // ambigua, no se elige ninguna al azar.
    if (cuentasOrigen.length > 1) {
      throw new ConvexError(
        `Hay ${cuentasOrigen.length}+ cuentas de contraseña con "${origen}". Abortado sin escribir.`,
      );
    }

    // Guarda 3 — idempotencia: si el origen ya no existe pero el destino sí,
    // la migración ya se hizo. Volver a correrla no escribe nada.
    if (cuentasOrigen.length === 0) {
      if (cuentasDestino.length === 1) {
        return `Sin cambios: la cuenta ya usa "${destino}" (id ${cuentasDestino[0]._id}).`;
      }
      throw new ConvexError(
        `No existe cuenta de contraseña con "${origen}" y tampoco con "${destino}". Nada que migrar.`,
      );
    }

    const cuenta = cuentasOrigen[0];

    // Guarda 4 — el destino ya está ocupado por OTRA cuenta: migrar crearía
    // dos credenciales con el mismo identificador y el login quedaría a suertes.
    if (cuentasDestino.length > 0) {
      throw new ConvexError(
        `"${destino}" ya pertenece a otra cuenta de contraseña (id ${cuentasDestino[0]._id}). Abortado sin escribir.`,
      );
    }

    // Guarda 5 — más de una cuenta de contraseña para el mismo usuario:
    // no se puede saber cuál es la buena.
    const cuentasDelUsuario = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", cuenta.userId).eq("provider", "password"),
      )
      .take(2);
    if (cuentasDelUsuario.length > 1) {
      throw new ConvexError(
        `El usuario ${cuenta.userId} tiene ${cuentasDelUsuario.length}+ cuentas de contraseña. Abortado sin escribir.`,
      );
    }

    await ctx.db.patch(cuenta._id, { providerAccountId: destino });

    const usuario = await ctx.db.get(cuenta.userId);
    const quien =
      usuario === null
        ? `usuario ${cuenta.userId} (no encontrado)`
        : `${usuario.name ?? "sin nombre"} <${usuario.email ?? "sin email"}> (${cuenta.userId})`;
    return `Migrada la cuenta de contraseña ${cuenta._id} de "${origen}" a "${destino}" — ${quien}.`;
  },
});
