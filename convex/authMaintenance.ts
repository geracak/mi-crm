import { v, ConvexError } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
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
 * real, conservando el hash de la contraseña (no fuerza cambiarla). Alinea
 * también `users.email` para que los dos campos dejen de divergir.
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
 * ⚠️ `userIdEsperado` es OBLIGATORIO a propósito. Sin él, una errata en
 * `emailActual` podía devolver "sin cambios" describiendo la cuenta de OTRA
 * persona y hacer creer que la migración se hizo. Exigirlo obliga a decir de
 * antemano a quién se va a tocar, y cualquier camino que resuelva una cuenta
 * distinta aborta. Ningún camino devuelve éxito sin identificar a quién afectó.
 *
 * Ejecutar en local (el id sale de `npx convex data users`):
 *   npx convex run authMaintenance:migrarIdentificadorPassword \
 *     '{"emailActual":"marta@vibecrm.local","emailNuevo":"gera.cak@gmail.com",
 *       "userIdEsperado":"<id de users>"}'
 */
export const migrarIdentificadorPassword = internalMutation({
  args: {
    emailActual: v.string(),
    emailNuevo: v.string(),
    userIdEsperado: v.id("users"),
  },
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

    /** Describe a quién pertenece una cuenta, para que ningún resultado sea anónimo. */
    const describir = async (cuenta: Doc<"authAccounts">) => {
      const usuario = await ctx.db.get(cuenta.userId);
      const quien =
        usuario === null
          ? `usuario ${cuenta.userId} (NO ENCONTRADO)`
          : `${usuario.name ?? "sin nombre"} <${usuario.email ?? "sin email"}> (${cuenta.userId})`;
      return `cuenta ${cuenta._id} — ${quien}`;
    };

    /** Aborta si la cuenta resuelta no es la de la persona que se declaró. */
    const exigirUsuarioEsperado = async (
      cuenta: Doc<"authAccounts">,
      contexto: string,
    ) => {
      if (cuenta.userId !== args.userIdEsperado) {
        throw new ConvexError(
          `Discrepancia: ${contexto} pertenece a ${await describir(cuenta)}, pero se esperaba el usuario ${args.userIdEsperado}. Abortado sin escribir.`,
        );
      }
    };

    /**
     * Alinea `users.email` con el destino si hace falta. La idempotencia de
     * esta mutación converge al estado objetivo: que un campo ya esté bien no
     * puede dejar el otro a medias, o un entorno migrado solo a medias se
     * quedaría así para siempre.
     *
     * Guarda: ese correo no puede figurar ya como `users.email` de OTRO
     * usuario. Dos filas con el mismo correo romperían el enlace del login con
     * Google (`convex/auth.ts`), que exige coincidencia única.
     */
    const alinearUsersEmail = async (userId: Doc<"users">["_id"]) => {
      const usuario = await ctx.db.get(userId);
      if (usuario === null || usuario.email === destino) return null;
      const ajenos = (
        await ctx.db
          .query("users")
          .withIndex("email", (q) => q.eq("email", destino))
          .take(2)
      ).filter((u) => u._id !== userId);
      if (ajenos.length > 0) {
        throw new ConvexError(
          `"${destino}" ya figura como users.email de otro usuario (${ajenos[0]._id}). Abortado sin escribir.`,
        );
      }
      const previo = usuario.email ?? "(sin email)";
      await ctx.db.patch(userId, { email: destino });
      return `users.email "${previo}" → "${destino}"`;
    };

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
    for (const [lista, cual] of [
      [cuentasOrigen, origen],
      [cuentasDestino, destino],
    ] as const) {
      if (lista.length > 1) {
        throw new ConvexError(
          `Hay ${lista.length}+ cuentas de contraseña con "${cual}". Abortado sin escribir.`,
        );
      }
    }

    // Guarda 3 — idempotencia. Antes bastaba con que existiera algo en el
    // destino; ahora además tiene que ser de la persona declarada, o si no
    // estaríamos dando por buena la migración de otra cuenta.
    if (cuentasOrigen.length === 0) {
      if (cuentasDestino.length === 1) {
        await exigirUsuarioEsperado(cuentasDestino[0], `el destino "${destino}"`);
        // La credencial ya está migrada, pero `users.email` puede haberse
        // quedado atrás: se termina el trabajo en vez de decir "sin cambios".
        const alineado = await alinearUsersEmail(cuentasDestino[0].userId);
        const quien = await describir(cuentasDestino[0]);
        return alineado === null
          ? `Sin cambios: ya estaba migrada — ${quien} usa "${destino}".`
          : `Ya estaba migrada la credencial; se completó lo que faltaba en ${quien}: ${alineado}.`;
      }
      throw new ConvexError(
        `No existe cuenta de contraseña con "${origen}" ni con "${destino}". Nada que migrar.`,
      );
    }

    const cuenta = cuentasOrigen[0];
    await exigirUsuarioEsperado(cuenta, `el origen "${origen}"`);

    // Guarda 4 — el destino ya está ocupado. Si es la MISMA cuenta (origen y
    // destino coinciden tras normalizar) no hay nada que hacer; si es otra,
    // migrar dejaría dos credenciales con el mismo identificador y el login
    // quedaría a suertes.
    if (cuentasDestino.length === 1) {
      if (cuentasDestino[0]._id === cuenta._id) {
        const alineado = await alinearUsersEmail(cuenta.userId);
        const quien = await describir(cuenta);
        return alineado === null
          ? `Sin cambios: ${quien} ya usa "${destino}".`
          : `La credencial ya usaba "${destino}"; se completó ${quien}: ${alineado}.`;
      }
      throw new ConvexError(
        `"${destino}" ya pertenece a otra ${await describir(cuentasDestino[0])}. Abortado sin escribir.`,
      );
    }

    // Guarda 5 — más de una cuenta de contraseña para el mismo usuario: no se
    // puede saber cuál es la buena.
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

    // `alinearUsersEmail` lleva dentro la guarda 6 (que el correo no sea ya de
    // otro usuario) y lanza antes de que se escriba nada, así que va primero.
    const alineado = await alinearUsersEmail(cuenta.userId);
    await ctx.db.patch(cuenta._id, { providerAccountId: destino });

    const detalleEmail =
      alineado === null ? "users.email ya estaba alineado" : alineado;
    return `Migrada ${await describir(cuenta)}: providerAccountId "${origen}" → "${destino}"; ${detalleEmail}.`;
  },
});
