"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ToastItem {
  id: number;
  message: string;
  undoLabel?: string;
  onUndo?: () => void;
}

interface ShowToastOptions {
  undoLabel?: string;
  onUndo?: () => void;
}

interface ToastContextValue {
  show: (message: string, options?: ShowToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Cola simple: cada toast se muestra por su propia duración y no reemplaza
// al anterior - marcar dos seguimientos seguidos no pierde el "Deshacer" del
// primero (a diferencia del prototipo .dc.html, que sí reemplazaba el toast).
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, options?: ShowToastOptions) => {
      const id = nextId.current++;
      const item: ToastItem = {
        id,
        message,
        undoLabel: options?.onUndo ? "Deshacer" : undefined,
        onUndo: options?.onUndo,
      };
      setToasts((prev) => [...prev, item]);
      const duration = options?.onUndo ? 3800 : 2600;
      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[1100] flex flex-col items-center gap-2 px-4 bottom-[84px] md:bottom-6"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-vibe-slide-up pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-xl bg-text py-3 pr-2.5 pl-4 text-white shadow-lg md:w-auto"
          >
            <span className="text-sm">{t.message}</span>
            {t.onUndo && (
              <button
                type="button"
                onClick={() => {
                  t.onUndo?.();
                  dismiss(t.id);
                }}
                className="cursor-pointer border-none bg-transparent px-2 py-1.5 text-sm font-semibold whitespace-nowrap text-primary"
              >
                {t.undoLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}
