"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { CerrarSesionOverlay } from "@/components/overlays/CerrarSesionOverlay";
import { useNavItems, useUsuarioActual } from "@/lib/useSesion";

const ROL_LABEL: Record<"propietaria" | "comercial", string> = {
  propietaria: "Dueña",
  comercial: "Atiende y vende",
};

export function Sidebar() {
  const pathname = usePathname();
  const navItems = useNavItems();
  const user = useUsuarioActual();
  const [confirmar, setConfirmar] = useState(false);

  return (
    <aside className="hidden h-full w-60 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3.5 md:flex">
      <div className="flex items-center gap-2.5 px-3 pb-5 pt-1.5">
        <span className="flex size-[26px] items-center justify-center rounded-md bg-primary text-[15px] font-semibold text-on-primary">
          V
        </span>
        <span className="text-base font-semibold text-text">Vibe CRM</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[15px] transition-colors",
                active
                  ? "bg-primary-subtle font-semibold text-primary"
                  : "font-medium text-text-muted hover:bg-surface-2",
              )}
            >
              <Icon className="size-5" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-1.5 border-t border-border pt-1.5">
        <Link
          href="/cuenta"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-surface-2"
        >
          <Avatar name={user?.name ?? ""} variant="neutral" size={32} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium text-text">
              {user?.name ?? "…"}
            </span>
            <span className="text-xs text-text-subtle">
              {user ? ROL_LABEL[user.rol] : ""}
            </span>
          </div>
        </Link>
        <button
          type="button"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          onClick={() => setConfirmar(true)}
          className="flex size-[34px] shrink-0 items-center justify-center rounded-md text-text-subtle hover:bg-surface-2"
        >
          <LogOut className="size-[18px]" aria-hidden />
        </button>
      </div>

      {confirmar && (
        <CerrarSesionOverlay onClose={() => setConfirmar(false)} />
      )}
    </aside>
  );
}
