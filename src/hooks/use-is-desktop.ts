"use client";

import { useEffect, useState } from "react";

const BREAKPOINT = 768;

// SSR-safe: por defecto asume móvil (mobile-first) hasta que el efecto corre
// en el cliente y puede leer window.innerWidth real.
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return isDesktop;
}
