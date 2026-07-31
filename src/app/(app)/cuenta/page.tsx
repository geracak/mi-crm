import { guardAuth } from "@/lib/authGuard";
import { CuentaClient } from "./CuentaClient";

/**
 * GER-218 — Perfil / Mi cuenta. La ve cualquiera con acceso: no hay gate de rol
 * (a diferencia de /equipo), solo la exigencia de sesión.
 *
 * `guardAuth` es una capa más, no LA capa: los datos los sirve
 * `usuarios:actual` y las escrituras pasan por `requireUsuario` en Convex, así
 * que saltarse esta pantalla no da acceso a nada.
 */
export default async function CuentaPage() {
  await guardAuth();
  return <CuentaClient />;
}
