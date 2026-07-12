import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * Usuario de la sesión actual. Lanza si no hay sesión O si el usuario no está
 * provisionado (sin `rol` válido) — esto bloquea las cuentas auto-registradas
 * vía `signIn("password", { flow: "signUp" })`, que nunca reciben rol.
 * Es la garantía dura de autorización: toda función de datos empieza por aquí.
 */
export async function requireUsuario(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new ConvexError("No autenticado");
  const user = await ctx.db.get(userId);
  if (user === null) throw new ConvexError("Usuario no encontrado");
  if (user.rol !== "propietaria" && user.rol !== "comercial") {
    throw new ConvexError("Usuario no provisionado");
  }
  return user;
}

/** Como `requireUsuario`, pero además exige el rol `propietaria`. */
export async function requirePropietaria(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const user = await requireUsuario(ctx);
  if (user.rol !== "propietaria") {
    throw new ConvexError("Acción restringida a la dueña");
  }
  return user;
}
