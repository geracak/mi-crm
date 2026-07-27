import { action, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { normalizarEmail, ENVIO_FALLIDO } from "./emailUtils";

/** Ventana del límite de solicitudes: como mucho una cada 60 segundos por correo. */
const VENTANA_THROTTLE_MS = 60 * 1000;

/**
 * GER-239 — Comprueba y registra en una sola transacción si toca dejar pasar
 * una solicitud de código, o si hay que frenarla por venir demasiado seguido.
 *
 * Indexa por el correo TAL CUAL se pidió, exista o no la cuenta: así el propio
 * límite no se convierte en un oráculo de qué correos tienen acceso (un correo
 * inexistente se frena exactamente igual que uno real).
 */
export const intentarRegistrarSolicitud = internalMutation({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const ahora = Date.now();
    const fila = await ctx.db
      .query("recuperacionThrottle")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (fila === null) {
      await ctx.db.insert("recuperacionThrottle", {
        email: args.email,
        ultimaSolicitud: ahora,
      });
      return true;
    }
    if (ahora - fila.ultimaSolicitud < VENTANA_THROTTLE_MS) {
      return false;
    }
    await ctx.db.patch(fila._id, { ultimaSolicitud: ahora });
    return true;
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
 * ⚠️ Riesgo de envío masivo (declarado en la issue): mitigado acá con
 * `intentarRegistrarSolicitud`. Si la solicitud viene demasiado seguida, se
 * responde "enviado" igual (misma razón que arriba: no delatar nada) pero se
 * corta ANTES de llamar a `signIn`, así que no se dispara ningún correo real
 * ni se invalida el código válido que ya estuviera pendiente.
 */
export const solicitarCodigo = action({
  args: { email: v.string() },
  returns: v.union(v.literal("enviado"), v.literal("fallo_envio")),
  handler: async (ctx, args): Promise<"enviado" | "fallo_envio"> => {
    const email = normalizarEmail(args.email);

    const permitido = await ctx.runMutation(
      internal.recuperacion.intentarRegistrarSolicitud,
      { email },
    );
    if (!permitido) {
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
        return "fallo_envio";
      }
      // Cualquier otro fallo (el habitual: no existe esa cuenta) se responde
      // igual que un envío correcto, a propósito.
      return "enviado";
    }
  },
});
