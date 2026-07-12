import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabBarItem {
  id: string;
  href: string;
  label: string;
  icon: ReactNode;
}

interface TabBarProps {
  items: TabBarItem[];
  active: string;
}

export function TabBar({ items, active }: TabBarProps) {
  return (
    <nav
      className="flex w-full border-t border-border bg-surface"
      role="tablist"
      aria-label="Navegación principal"
    >
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 transition-colors duration-150 [transition-timing-function:var(--ease-standard)]",
              isActive ? "font-semibold text-primary" : "font-medium text-text-subtle",
            )}
          >
            <span aria-hidden="true" className="inline-flex h-[22px] w-[22px]">
              {item.icon}
            </span>
            <span className="text-[11px] tracking-tight">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
