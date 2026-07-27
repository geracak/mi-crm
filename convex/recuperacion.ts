import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { normalizarEmail, ENVIO_FALLIDO } from "./emailUtils";

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
 * enumeración sigue abierta — es el riesgo ya declarado en la issue.)
 */
export const solicitarCodigo = action({
  args: { email: v.string() },
  returns: v.union(v.literal("enviado"), v.literal("fallo_envio")),
  handler: async (ctx, args): Promise<"enviado" | "fallo_envio"> => {
    const email = normalizarEmail(args.email);
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
