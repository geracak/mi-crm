import { guardAuth } from "@/lib/authGuard";
import { Proximamente } from "@/components/Proximamente";

export default async function CuentaPage() {
  await guardAuth();
  return <Proximamente titulo="Perfil / Mi cuenta" />;
}
