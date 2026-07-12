import { EmptyState } from "@/components/ui/empty-state";
import { Users } from "lucide-react";

// Stub: la lista de clientes con buscador es GER-27/GER-28, fuera de alcance
// de este trabajo. Existe como destino real de navegación para el shell.
export default function ClientesPage() {
  return (
    <EmptyState
      icon={<Users size={24} strokeWidth={1.5} />}
      title="Próximamente"
      help="La lista de clientes se construye en otro ticket (GER-27/GER-28)."
    />
  );
}
