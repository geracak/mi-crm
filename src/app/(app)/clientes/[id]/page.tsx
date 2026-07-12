import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { EmptyState } from "@/components/ui/empty-state";
import { UserRound } from "lucide-react";

// Stub mínimo: la ficha de cliente completa es GER-27/GER-28. Esta ruta
// existe solo para que tocar una fila en Hoy tenga un destino real y no
// rompa con un ID inválido/inexistente.
export default async function ClienteDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cliente = await fetchQuery(api.clientes.getById, { id });

  if (!cliente) {
    return (
      <EmptyState
        icon={<UserRound size={24} strokeWidth={1.5} />}
        title="Cliente no encontrado"
        help="El cliente no existe o el enlace ya no es válido."
      />
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-text">{cliente.nombre}</h1>
      <p className="text-sm text-text-muted">
        Ficha completa de cliente pendiente (GER-27/GER-28). Estado: {cliente.estado}.
      </p>
    </div>
  );
}
