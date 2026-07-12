import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError } from "convex/values";
import type { DataModel } from "./_generated/dataModel";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      // Perfil PÚBLICO del signUp: solo email/name, NUNCA rol. Así una llamada
      // maliciosa a signIn("password", { flow: "signUp" }) no puede autoasignarse
      // un rol; el único profile con rol lo produce el seed (createAccount).
      profile(params) {
        return {
          email: params.email as string,
          name: (params.name as string | undefined) || undefined,
        };
      },
    }),
  ],
  callbacks: {
    // Regla de aprovisionamiento (no "rechazar toda creación", que bloquearía el
    // propio seed): se crea un usuario nuevo SOLO si el profile trae un rol
    // válido, y ese rol solo lo produce el seed interno vía createAccount.
    //
    // Nota: con el proveedor Password, el sign-in normal NO pasa por este
    // callback (solo se invoca al CREAR cuenta: signUp público o createAccount).
    // Por eso el branch `existingUserId` casi nunca se ejerce con Password; se
    // mantiene por corrección (account linking).
    async createOrUpdateUser(ctx, args) {
      if (args.existingUserId !== null) {
        return args.existingUserId;
      }
      const profile = args.profile as Record<string, unknown>;
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
