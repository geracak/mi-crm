import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";

// TODO(GER-217): agregar proxy.ts que redirija a /login si no hay sesión.
// Por ahora el shell renderiza siempre "autenticado" con el usuario demo
// sembrado (ver convex/users.ts) - no hay enforcement de rutas todavía.
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
