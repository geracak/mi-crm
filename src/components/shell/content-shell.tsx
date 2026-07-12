import type { ReactNode } from "react";

// Deja padding-bottom suficiente en móvil para que ninguna fila ni el toast
// queden tapados detrás del TabBar inferior fijo.
export function ContentShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto px-4 pt-4 pb-24 md:max-w-[860px] md:px-8 md:pt-7 md:pb-14">
        {children}
      </div>
    </div>
  );
}
