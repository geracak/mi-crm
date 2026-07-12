"use client";

import { Plus, MessageSquarePlus, HandCoins, UserPlus } from "lucide-react";
import { cn } from "@/lib/cn";

export type QuickActionId = "nueva-tarea" | "anotar-interaccion" | "registrar-venta" | "nuevo-cliente";

interface QuickActionsProps {
  onSelect: (action: QuickActionId) => void;
}

const ACTIONS: { id: QuickActionId; label: string; icon: React.ReactNode; primary?: boolean }[] = [
  { id: "nueva-tarea", label: "Nueva tarea", icon: <Plus size={20} strokeWidth={1.5} />, primary: true },
  {
    id: "anotar-interaccion",
    label: "Anotar interacción",
    icon: <MessageSquarePlus size={20} strokeWidth={1.5} />,
  },
  { id: "registrar-venta", label: "Registrar venta", icon: <HandCoins size={20} strokeWidth={1.5} /> },
  { id: "nuevo-cliente", label: "Nuevo cliente", icon: <UserPlus size={20} strokeWidth={1.5} /> },
];

export function QuickActions({ onSelect }: QuickActionsProps) {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      {ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onSelect(action.id)}
          className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-4 text-center shadow-xs transition-colors duration-150 hover:bg-surface-2"
        >
          <span
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full",
              action.primary ? "bg-primary text-on-primary" : "bg-primary-subtle text-primary",
            )}
            aria-hidden="true"
          >
            {action.icon}
          </span>
          <span className="text-[13px] font-medium text-text">{action.label}</span>
        </button>
      ))}
    </div>
  );
}
