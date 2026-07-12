import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { EmptyState } from "@/components/ui/empty-state";
import { ShieldAlert, UserCog } from "lucide-react";

// Gating real, no solo visual: aunque la sidebar/TabBar oculten "Equipo"
// para rol !== "propietaria", esta ruta valida el rol server-side en cada
// render - navegar acá por URL directa con un usuario "comercial" nunca
// muestra el contenido real. Autorización completa con sesión real: GER-217/GER-219.
export default async function EquipoPage() {
  const currentUser = await fetchQuery(api.users.getCurrent);

  if (currentUser?.rol !== "propietaria") {
    return (
      <EmptyState
        icon={<ShieldAlert size={24} strokeWidth={1.5} />}
        title="Sin acceso"
        help="Esta sección es solo para la dueña del negocio."
      />
    );
  }

  return (
    <EmptyState
      icon={<UserCog size={24} strokeWidth={1.5} />}
      title="Próximamente"
      help="Gestión de usuarios y roles se construye en otro ticket (GER-219)."
    />
  );
}
