import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { startOfDay, endOfDay } from "date-fns";

// Zona de negocio fija para clasificar Atrasados/Para hoy/Próximas - nunca la
// timezone implícita del runtime (servidor en UTC, navegador en la del
// usuario). Módulo sin dependencias de Convex para poder importarse tal cual
// desde convex/seguimientos.ts y desde un script de verificación (misma
// función, no una reimplementación paralela).
export const BUSINESS_TZ = "America/Argentina/Buenos_Aires";

export function todayBoundsMs(now: number) {
  const nowZoned = toZonedTime(now, BUSINESS_TZ);
  const startOfDayMs = fromZonedTime(startOfDay(nowZoned), BUSINESS_TZ).getTime();
  const endOfDayMs = fromZonedTime(endOfDay(nowZoned), BUSINESS_TZ).getTime();
  return { startOfDayMs, endOfDayMs };
}
