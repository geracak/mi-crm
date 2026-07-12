import { differenceInCalendarDays, format } from "date-fns";
import { es } from "date-fns/locale";

export function eyebrowDate(date: Date) {
  return format(date, "EEEE, d 'de' MMMM", { locale: es }).toUpperCase();
}

// Fecha relativa para una fila de seguimiento. La clasificación
// atrasado/hoy/próximo ya viene resuelta desde Convex (timezone de negocio
// fija); esto solo formatea la etiqueta para mostrar.
export function relativeDueLabel(venceMs: number) {
  const days = differenceInCalendarDays(new Date(venceMs), new Date());
  if (days === 0) return "Vence hoy";
  if (days === -1) return "Hace 1 día";
  if (days < 0) return `Hace ${Math.abs(days)} días`;
  if (days === 1) return "Mañana";
  return `En ${days} días`;
}
