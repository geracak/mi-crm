import { EmptyState } from "@/components/ui/empty-state";
import { UserCircle } from "lucide-react";

// Stub: Perfil / Mi cuenta (F17) es GER-218, fuera de alcance.
export default function CuentaPage() {
  return (
    <EmptyState
      icon={<UserCircle size={24} strokeWidth={1.5} />}
      title="Próximamente"
      help="Mi cuenta se construye en otro ticket (GER-218)."
    />
  );
}
