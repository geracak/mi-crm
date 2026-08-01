"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { SECTION_TITLES, esPantallaPush } from "@/lib/nav";
import { Avatar } from "@/components/ui/Avatar";
import { useUsuarioActual } from "@/lib/useSesion";

/**
 * Cabecera compartida (60px, borde inferior). Botón atrás automático en
 * subrutas (p. ej. /clientes/123) y en las pantallas "push". El avatar abre
 * "Mi cuenta" — y no se muestra estando ya en ella.
 */
export function MobileHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useUsuarioActual();

  const base = "/" + pathname.split("/").slice(1, 2).join("");
  const isSubroute = pathname.split("/").filter(Boolean).length > 1;
  // `/cuenta` es de primer nivel pero se entra "encima" de la navegación, así
  // que necesita la vuelta atrás igual que una subruta.
  const showBack = isSubroute || esPantallaPush(pathname);
  const enCuenta = pathname === "/cuenta";
  const title = SECTION_TITLES[pathname] ?? SECTION_TITLES[base] ?? "Vibe CRM";

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
      {showBack && (
        <button
          type="button"
          aria-label="Atrás"
          onClick={() => router.back()}
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-text hover:bg-surface-2"
        >
          <ChevronLeft className="size-[22px]" aria-hidden />
        </button>
      )}
      <h2 className="flex-1 truncate pl-1 text-[17px] font-semibold text-blue-600 dark:text-blue-400">
        {title}
      </h2>
      {!enCuenta && (
        <Link
          href="/cuenta"
          aria-label="Mi cuenta"
          className="flex size-11 shrink-0 items-center justify-center rounded-full md:hidden"
        >
          <Avatar name={user?.name ?? ""} variant="neutral" size={32} />
        </Link>
      )}
    </header>
  );
}
