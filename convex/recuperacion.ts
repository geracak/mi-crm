import { action, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { normalizarEmail, ENVIO_FALLIDO } from "./emailUtils";

/** Ventana del límite de solicitudes: como mucho una cada 60 segundos por correo. */
const VENTANA_THROTTLE_MS = 60 * 1000;

/** Filas de `recuperacionThrottle` sin refrescar hace más de esto ya no sirven de nada. */
const RETENCION_THROTTLE_MS = 60 * 60 * 1000; // 1 hora

/**
 * GER-239 — Reserva un turno de solicitud si toca, o dice que hay que frenarla
 * por venir demasiado seguido. Es una RESERVA, no una confirmación: el llamador
 * (`solicitarCodigo`) debe liberarla con `liberarSolicitud` si el envío
 * termina fallando de verdad, o la reserva se queda puesta sin que haya salido
 * ningún correo.
 *
 * Indexa por el correo TAL CUAL se pidió, exista o no la cuenta: así el propio
 * límite no se convierte en un oráculo de qué correos tienen acceso (un correo
 * inexistente se frena exactamente igual que uno real).
 *
 * Devuelve `valorAnterior` (el `ultimaSolicitud` que había antes de reservar,
 * o `null` si la fila no existía) para que `liberarSolicitud` pueda devolver la
 * fila a como estaba, no solo borrar el turno actual.
 */
export const intentarRegistrarSolicitud = internalMutation({
  args: { email: v.string() },
  returns: v.union(
    v.object({ permitido: v.literal(false) }),
    v.object({ permitido: v.literal(true), valorAnterior: v.union(v.number(), v.null()) }),
  ),
  handler: async (ctx, args) => {
    const ahora = Date.now();
    const fila = await ctx.db
      .query("recuperacionThrottle")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (fila !== null && ahora - fila.ultimaSolicitud < VENTANA_THROTTLE_MS) {
      return { permitido: false as const };
    }

    const valorAnterior = fila?.ultimaSolicitud ?? null;
    if (fila === null) {
      await ctx.db.insert("recuperacionThrottle", {
        email: args.email,
        ultimaSolicitud: ahora,
      });
    } else {
      await ctx.db.patch(fila._id, { ultimaSolicitud: ahora });
    }
    return { permitido: true as const, valorAnterior };
  },
});

/**
 * GER-239 — Deshace una reserva de `intentarRegistrarSolicitud` cuando el
 * envío termina en `ENVIO_FALLIDO`.
 *
 * ⚠️ Por qué hace falta: sin esto, un fallo REAL de Resend (DNS, timeout, 5xx)
 * dejaba la fila con `ultimaSolicitud = ahora` de todas formas — la reserva se
 * hace ANTES de saber si el envío va a funcionar. Un reintento inmediato caía
 * bloqueado por el propio límite y devolvía "enviado" sin volver a intentar
 * nada: el bloqueante original (avisar de un código que nunca salió),
 * reintroducido por el camino de reintento. Encontrado por auditoría.
 *
 * Vuelve la fila a `valorAnterior` (o la borra si no había fila antes), en vez
 * de simplemente borrar la fila actual: si ya había una solicitud legítima más
 * antigua, ese momento se conserva.
 */
export const liberarSolicitud = internalMutation({
  args: { email: v.string(), valorAnterior: v.union(v.number(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const fila = await ctx.db
      .query("recuperacionThrottle")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (fila === null) return null; // ya no está: nada que deshacer
    if (args.valorAnterior === null) {
      await ctx.db.delete(fila._id);
    } else {
      await ctx.db.patch(fila._id, { ultimaSolicitud: args.valorAnterior });
    }
    return null;
  },
});

/**
 * GER-239 — Limpieza periódica de `recuperacionThrottle`. Es una acción
 * pública sin autenticación (tiene que serlo: se llama antes del login), así
 * que nada impide que alguien la invoque con muchos correos inventados
 * distintos y haga crecer la tabla sin límite. Igual que
 * `authMaintenance:limpiarVerifiersHuerfanos`, se poda por cron en vez de
 * intentar frenar la escritura en el momento.
 */
export const limpiarThrottleAntiguo = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const corte = Date.now() - RETENCION_THROTTLE_MS;
    const filas = await ctx.db.query("recuperacionThrottle").take(500);
    for (const fila of filas) {
      if (fila.ultimaSolicitud < corte) {
        await ctx.db.delete(fila._id);
      }
    }
    return null;
  },
});

/**
 * GER-239 — Solicitud del código de recuperación.
 *
 * ⚠️ Por qué existe esta envoltura en vez de llamar a `signIn` desde el cliente:
 * la marca `ENVIO_FALLIDO` NO sobrevive el viaje al navegador. Comprobado
 * empíricamente: el `ConvexError` lanzado dentro de `sendVerificationRequest`
 * llega al cliente como un `Error` PLANO — sin `data`, con la marca solo dentro
 * del texto del mensaje. Y el texto de los errores no-ConvexError lo censura
 * Convex fuera de desarrollo, así que detectarlo por string funcionaría en dev
 * y fallaría en producción, en silencio, volviendo a decir "te enviamos un
 * código" cuando no salió nada. Que es exactamente el bloqueante.
 *
 * Aquí el error se atrapa en el SERVIDOR, donde el mensaje sí está intacto, y
 * se devuelve un VALOR. El cliente ya no interpreta excepciones.
 *
 * Efecto secundario buscado: los dos resultados posibles son indistinguibles
 * para un correo que no existe, así que esta función no sirve de oráculo de qué
 * correos tienen cuenta. (Ojo: `auth:signIn` sigue siendo pública y por ahí la
 * enumeración sigue abierta — riesgo declarado y aceptado en la issue.)
 *
 * ⚠️ Riesgo de envío masivo (declarado en la issue): mitigado con
 * `intentarRegistrarSolicitud`/`liberarSolicitud`. Si la solicitud viene
 * demasiado seguida, se responde "enviado" igual (misma razón que arriba: no
 * delatar nada) pero se corta ANTES de llamar a `signIn`, así que no se
 * dispara ningún correo real ni se invalida el código válido que ya estuviera
 * pendiente. Y si el intento sí llega a Resend pero falla de verdad, la
 * reserva se libera para que el siguiente intento no la encuentre bloqueada
 * por un envío que nunca salió.
 */
export const solicitarCodigo = action({
  args: { email: v.string() },
  returns: v.union(v.literal("enviado"), v.literal("fallo_envio")),
  handler: async (ctx, args): Promise<"enviado" | "fallo_envio"> => {
    const email = normalizarEmail(args.email);

    const reserva = await ctx.runMutation(
      internal.recuperacion.intentarRegistrarSolicitud,
      { email },
    );
    if (!reserva.permitido) {
      return "enviado";
    }

    try {
      await ctx.runAction(api.auth.signIn, {
        provider: "password",
        params: { email, flow: "reset" },
      });
      return "enviado";
    } catch (err) {
      const texto = err instanceof Error ? err.message : String(err);
      if (texto.includes(ENVIO_FALLIDO)) {
        await ctx.runMutation(internal.recuperacion.liberarSolicitud, {
          email,
          valorAnterior: reserva.valorAnterior,
        });
        return "fallo_envio";
      }
      // Cualquier otro fallo (el habitual: no existe esa cuenta) se responde
      // igual que un envío correcto, a propósito. Acá SÍ se deja la reserva
      // puesta: no llegó a llamarse a Resend, así que no hay nada que revertir
      // y frenar reintentos de un correo inexistente no cuesta nada.
      return "enviado";
    }
  },
});
