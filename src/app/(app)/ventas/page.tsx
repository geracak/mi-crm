import { EmptyState } from "@/components/ui/empty-state";
import { TrendingUp } from "lucide-react";

// Stub: la pantalla de Ventas y oportunidades es GER-220, fuera de alcance.
export default function VentasPage() {
  return (
    <EmptyState
      icon={<TrendingUp size={24} strokeWidth={1.5} />}
      title="Próximamente"
      help="Ventas y oportunidades se construye en otro ticket (GER-220)."
    />
  );
}
