"use client";

import { usePathname } from "next/navigation";
import { TabBar } from "@/components/ui/TabBar";
import { useNavItems } from "@/lib/useSesion";
import { esPantallaPush } from "@/lib/nav";

/**
 * Barra inferior móvil con los ítems filtrados por rol (Equipo solo dueña).
 * Se oculta en las pantallas "push" (ficha de cliente y /cuenta), que traen su
 * propio botón atrás.
 */
export function TabBarNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const items = useNavItems();
  if (esPantallaPush(pathname)) return null;
  return <TabBar items={items} className={className} />;
}
