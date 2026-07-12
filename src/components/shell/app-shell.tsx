"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { CalendarCheck, Users, TrendingUp, UserCog } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import { TabBar, type TabBarItem } from "@/components/ui/tab-bar";
import { Avatar } from "@/components/ui/avatar";
import { ContentShell } from "@/components/shell/content-shell";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { ToastProvider } from "@/components/ui/toast";

const BASE_NAV_ITEMS: TabBarItem[] = [
  { id: "hoy", href: "/hoy", label: "Hoy", icon: <CalendarCheck size={22} strokeWidth={1.5} /> },
  { id: "clientes", href: "/clientes", label: "Clientes", icon: <Users size={22} strokeWidth={1.5} /> },
  { id: "ventas", href: "/ventas", label: "Ventas", icon: <TrendingUp size={22} strokeWidth={1.5} /> },
];

const EQUIPO_ITEM: TabBarItem = {
  id: "equipo",
  href: "/equipo",
  label: "Equipo",
  icon: <UserCog size={22} strokeWidth={1.5} />,
};

export function AppShell({ children }: { children: ReactNode }) {
  const isDesktop = useIsDesktop();
  const pathname = usePathname();
  // TODO(GER-217): reemplazar por sesión real - hoy siempre es el usuario
  // demo sembrado (ver convex/users.ts).
  const currentUser = useQuery(api.users.getCurrent);

  const navItems =
    currentUser?.rol === "propietaria" ? [...BASE_NAV_ITEMS, EQUIPO_ITEM] : BASE_NAV_ITEMS;

  const activeId = navItems.find((item) => pathname.startsWith(item.href))?.id ?? "hoy";

  return (
    <ToastProvider>
      <div className="flex h-dvh flex-col md:flex-row">
        {isDesktop && (
          <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-surface">
            <div className="flex items-center gap-2.5 px-5 py-5">
              <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-primary font-semibold text-on-primary">
                V
              </span>
              <span className="font-semibold text-text">Vibe CRM</span>
            </div>
            <nav className="flex flex-1 flex-col gap-1 px-3">
              {navItems.map((item) => {
                const isActive = item.id === activeId;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] transition-colors duration-150 " +
                      (isActive
                        ? "bg-primary-subtle font-semibold text-primary"
                        : "font-medium text-text-muted hover:bg-surface-2")
                    }
                  >
                    <span aria-hidden="true" className="inline-flex h-[22px] w-[22px]">
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <Link
              href="/cuenta"
              className="flex items-center gap-3 border-t border-border px-5 py-4 hover:bg-surface-2"
            >
              <Avatar name={currentUser?.name ?? ""} size={36} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-text">
                  {currentUser?.name ?? "Cargando..."}
                </span>
                <span className="truncate text-xs text-text-muted">
                  {currentUser?.rol === "propietaria" ? "Dueña" : "Comercial"}
                </span>
              </div>
            </Link>
          </aside>
        )}

        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-surface px-4">
            <span className="text-[15px] font-semibold text-text">
              {navItems.find((i) => i.id === activeId)?.label ?? "Vibe CRM"}
            </span>
            {!isDesktop && (
              <Link
                href="/cuenta"
                aria-label="Mi cuenta"
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-2"
              >
                <Avatar name={currentUser?.name ?? ""} size={32} />
              </Link>
            )}
          </header>

          <ContentShell>{children}</ContentShell>

          {!isDesktop && <TabBar items={navItems} active={activeId} />}
        </div>
      </div>
    </ToastProvider>
  );
}
