import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

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
