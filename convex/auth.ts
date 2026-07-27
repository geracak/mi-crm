import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import Google from "@auth/core/providers/google";
import { ConvexError } from "convex/values";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { ResendOTP } from "./ResendOTP";
import { normalizarEmail } from "./emailUtils";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      // GER-239: proveedor del código de un solo uso para el flujo `reset`.
      // Habilita signIn("password", { flow: "reset" | "reset-verification" }).
      reset: ResendOTP,
      // Perfil PÚBLICO del signUp: solo email/name, NUNCA rol. Así una llamada
      // maliciosa a signIn("password", { flow: "signUp" }) no puede autoasignarse
      // un rol; el único profile con rol lo produce el seed (createAccount).
      //
      // GER-239: `profile` corre en TODOS los flujos (signUp, signIn, reset,
      // reset-verification), así que normalizar aquí es lo que hace que
      // `retrieveAccount` encuentre la cuenta sin importar cómo se teclee el
      // correo. NO basta por sí solo: la verificación posterior compara los
      // params ORIGINALES, y de eso se ocupa el `authorize` de ResendOTP.
      profile(params) {
        return {
          email: normalizarEmail(params.email as string),
          name: (params.name as string | undefined) || undefined,
        };
      },
    }),
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

      const rol = profile.rol;
      if (rol !== "propietaria" && rol !== "comercial") {
        throw new ConvexError("Registro no permitido");
      }
      return await ctx.db.insert("users", {
        email: typeof profile.email === "string" ? profile.email : undefined,
        name: typeof profile.name === "string" ? profile.name : undefined,
        rol,
      });
    },
  },
});
