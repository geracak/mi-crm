import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import Google from "@auth/core/providers/google";
import { ConvexError } from "convex/values";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { ResendOTP } from "./ResendOTP";
import { normalizarEmail } from "./emailUtils";

/**
 * GER-240 — Mensaje ÚNICO de rechazo del registro. Se usa igual en el wrapper y
 * en `createOrUpdateUser` a propósito: dos textos distintos volverían a separar
 * "este correo ya existe" de "este correo no existe", que es justo el oráculo de
 * enumeración que este cambio cierra (hallazgo A2).
 */
const REGISTRO_NO_PERMITIDO = "Registro no permitido";

const passwordBase = Password<DataModel>({
  // GER-239: proveedor del código de un solo uso para el flujo `reset`.
  // Habilita signIn("password", { flow: "reset" | "reset-verification" }).
  reset: ResendOTP,
  // Perfil PÚBLICO: solo email/name, NUNCA rol. El único profile con rol lo
  // produce el seed (createAccount).
  //
  // GER-239: `profile` corre en los flujos que quedan vivos (signIn, reset,
  // reset-verification), así que normalizar aquí es lo que hace que
  // `retrieveAccount` encuentre la cuenta sin importar cómo se teclee el
  // correo. NO basta por sí solo: la verificación posterior compara los
  // params ORIGINALES, y de eso se ocupan el wrapper de abajo y el `authorize`
  // de ResendOTP.
  profile(params) {
    return {
      email: normalizarEmail(params.email as string),
      name: (params.name as string | undefined) || undefined,
    };
  },
});

/**
 * GER-240 — Punto de control ÚNICO de todo lo que entra por `auth:signIn`.
 *
 * ⚠️ Por qué existe: `auth:signIn` es una acción PÚBLICA (lo tiene que ser) y
 * su rama `flow: "signUp"` verificaba la contraseña de una cuenta existente SIN
 * consultar `authRateLimits` — ver
 * `dist/server/implementation/mutations/createAccountFromCredentials.js:23-40`,
 * donde `Provider.verify` se llama a pelo. La rama `flow: "signIn"` sí aplica el
 * límite de 10 fallos/hora (`.../retrieveAccountWithCredentials.js:26-33`).
 * Resultado medido contra el deployment de desarrollo antes de este cambio:
 * 20 intentos seguidos sin bloqueo, `authRateLimits` sin tocar (attemptsLeft
 * 9 → 9) y la contraseña correcta devolviendo tokens con sesión nueva.
 *
 * ⚠️ Por qué el wrapper va dentro de `options` y NO en el nivel superior:
 * `ConvexCredentials(config)` devuelve
 * `{ id, type, authorize: async () => null, options: config }`
 * (`dist/providers/ConvexCredentials.js:28-35`) y al materializar,
 * `providerDefaults` hace `merge(provider, provider.options)`
 * (`dist/server/provider_utils.js:144-161`). Como `merge` no considera objeto a
 * una función, `options.authorize` PISA al de arriba con `Object.assign`.
 * Sobrescribir el de arriba no haría absolutamente nada.
 *
 * ⚠️ `options` es un interno de la librería (lo marca `@ts-expect-error
 * Internal`), así que este acoplamiento se protege con la aserción de abajo:
 * si una futura versión cambia la forma, el módulo LANZA al cargarse y el
 * deploy falla ruidoso. Nunca en silencio, que es como se pierden los controles.
 */
type AuthorizeCredenciales = (
  params: Record<string, unknown>,
  ctx: unknown,
) => Promise<unknown>;

const opcionesPassword = (
  passwordBase as unknown as { options?: { authorize?: unknown } }
).options;

if (typeof opcionesPassword?.authorize !== "function") {
  throw new Error(
    "@convex-dev/auth cambió de forma: `options.authorize` ya no existe en el provider Password. " +
      "El wrapper de seguridad de convex/auth.ts (GER-240) depende de él — revisarlo antes de desplegar.",
  );
}

const authorizeOriginal = opcionesPassword.authorize as AuthorizeCredenciales;

const PasswordEndurecido = {
  ...passwordBase,
  options: {
    ...opcionesPassword,
    authorize: async (params: Record<string, unknown>, ctx: unknown) => {
      // 1) Registro cerrado, aplicado ANTES de mirar ninguna credencial. Cortar
      //    aquí es lo que elimina el acceso al `Provider.verify` sin límite.
      //    El mismo error para todos los casos: sin oráculo de enumeración.
      if (params.flow === "signUp") {
        throw new ConvexError(REGISTRO_NO_PERMITIDO);
      }

      // 2) Normalizar el correo en una COPIA. La librería propaga estos mismos
      //    `params` hasta `verifyCodeAndSignInImpl`, que usa `params.email` en
      //    crudo como clave del límite de intentos del código
      //    (`dist/server/implementation/mutations/verifyCodeAndSignIn.js:22`).
      //    Sin esto, variar mayúsculas o espacios abre un cubo nuevo en
      //    `authRateLimits` y el límite del OTP deja de servir de nada.
      const email = params.email;
      const paramsNormalizados =
        typeof email === "string"
          ? { ...params, email: normalizarEmail(email) }
          : params;

      return await authorizeOriginal(paramsNormalizados, ctx);
    },
  },
  // El objeto lleva `options`, que no está en el tipo público del provider. El
  // cast es deliberado y la aserción de arriba es lo que sustituye a la
  // comprobación de tipos.
} as unknown as typeof passwordBase;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    PasswordEndurecido,
    Google({
      // Mapeo explícito: nos interesa `email_verified` para decidir el linking
      // en createOrUpdateUser (nunca vincular con un email que Google no verificó).
      profile(googleProfile) {
        return {
          id: googleProfile.sub,
          email: googleProfile.email,
          name: googleProfile.name,
          image: googleProfile.picture,
          emailVerified: googleProfile.email_verified,
        };
      },
    }),
  ],
  callbacks: {
    // Regla de aprovisionamiento (no "rechazar toda creación", que bloquearía el
    // propio seed): se crea un usuario nuevo SOLO si el profile trae un rol
    // válido, y ese rol solo lo produce el seed interno vía createAccount.
    // Google NUNCA crea usuarios: solo puede VINCULARSE a uno ya provisionado
    // (registro cerrado por diseño — GER-238).
    async createOrUpdateUser(ctxLoose, args) {
      // `ctxLoose.db` viene tipado contra `AnyDataModel` (firma genérica de la
      // librería) y no conoce nuestro índice `email`; casteamos al `MutationCtx`
      // generado para este proyecto, que sí lo tiene.
      const ctx = ctxLoose as unknown as MutationCtx;

      // Revalida el rol SIEMPRE, incluso en la ruta ya vinculada: una cuenta
      // desprovisionada (rol removido después de vincularse) no debe poder
      // re-autenticar solo porque su authAccount ya existía de antes.
      if (args.existingUserId !== null) {
        const usuario = await ctx.db.get(args.existingUserId);
        if (
          usuario === null ||
          (usuario.rol !== "propietaria" && usuario.rol !== "comercial")
        ) {
          throw new ConvexError(
            "Esta cuenta ya no tiene acceso. Contactá a la persona dueña del CRM.",
          );
        }
        return args.existingUserId;
      }

      const profile = args.profile as Record<string, unknown> & {
        email?: string;
        emailVerified?: boolean;
      };

      if (args.provider.id === "google") {
        const email =
          typeof profile.email === "string" ? profile.email : undefined;
        // Google no verificó el email → nunca vincular (evita takeover de cuenta).
        if (!email || profile.emailVerified !== true) {
          throw new ConvexError(
            "Esta cuenta de Google no tiene acceso. Contactá a la persona dueña del CRM.",
          );
        }
        // Mismo patrón que `uniqueUserWithVerifiedEmail` de la librería
        // (@convex-dev/auth/dist/server/implementation/users.js): 0 o >1
        // coincidencias se tratan igual (rechazo neutro), nunca se elige al azar.
        const candidatos = await ctx.db
          .query("users")
          .withIndex("email", (q) => q.eq("email", email))
          .take(2);
        const existente = candidatos.length === 1 ? candidatos[0] : null;
        if (
          existente === null ||
          (existente.rol !== "propietaria" && existente.rol !== "comercial")
        ) {
          throw new ConvexError(
            "Esta cuenta de Google no tiene acceso. Contactá a la persona dueña del CRM.",
          );
        }
        return existente._id; // vincula, no crea
      }

      // Defensa en profundidad: el wrapper ya corta `flow: "signUp"` antes de
      // llegar aquí (GER-240). Esto sigue cubriendo cualquier otro camino que
      // intente crear un usuario sin rol válido.
      const rol = profile.rol;
      if (rol !== "propietaria" && rol !== "comercial") {
        throw new ConvexError(REGISTRO_NO_PERMITIDO);
      }
      return await ctx.db.insert("users", {
        email: typeof profile.email === "string" ? profile.email : undefined,
        name: typeof profile.name === "string" ? profile.name : undefined,
        rol,
      });
    },
  },
});
