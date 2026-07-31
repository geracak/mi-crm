"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { NAV_ITEMS } from "@/lib/nav";

/**
 * Usuario de la sesión actual. Devuelve `undefined` mientras carga o sin sesión.
 * Se salta la query si aún no hay sesión (evita el error de `requireUsuario`).
 */
export function useUsuarioActual() {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.usuarios.actual, isAuthenticated ? {} : "skip");
}

/**
 * Ítems de navegación filtrados por rol: "Equipo" solo para la dueña. Es el gate
 * VISUAL; la autorización real de /equipo se hace server-side en su página.
 */
export function useNavItems() {
  const user = useUsuarioActual();
  const esPropietaria = user?.rol === "propietaria";
  return NAV_ITEMS.filter((i) => i.href !== "/equipo" || esPropietaria);
}

/**
 * GER-218 — Cierra la sesión y vuelve al login.
 *
 * ⚠️ El `signOut()` no es opcional ni "por limpieza": `src/proxy.ts:22-24`
 * manda a `/hoy` a cualquiera que pise `/login` estando autenticado, así que un
 * simple `<Link href="/login">` rebotaría sin salir de la sesión. Primero se
 * cierra, después se navega.
 *
 * `replace` y no `push`: el historial no debe poder volver a la app ya cerrada.
 */
export function useCerrarSesion() {
  const router = useRouter();
  const { signOut } = useAuthActions();
  return useCallback(async () => {
    await signOut();
    router.replace("/login");
  }, [router, signOut]);
}
