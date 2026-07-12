// Script de verificación manual de borde de timezone. Importa el MISMO
// módulo que usa convex/seguimientos.ts (no una reimplementación) para
// confirmar que la clasificación de medianoche en Buenos Aires es correcta.
// Vive fuera de convex/ a propósito: no es una función desplegable y no debe
// empaquetarse junto con las funciones reales de Convex.
// Correr con: npx tsx scripts/verify-date-bounds.ts
import { todayBoundsMs, BUSINESS_TZ } from "../convex/dateBounds";

function assert(condition: boolean, label: string) {
  console.log(`${condition ? "OK  " : "FAIL"} - ${label}`);
  if (!condition) process.exitCode = 1;
}

console.log(`Timezone bajo prueba: ${BUSINESS_TZ}\n`);

// 'now' = 2026-07-12T02:30:00Z = 2026-07-11 23:30 en Buenos Aires (UTC-3, sin DST)
const now = Date.parse("2026-07-12T02:30:00Z");
const { startOfDayMs, endOfDayMs } = todayBoundsMs(now);

console.log("now (UTC):        ", new Date(now).toISOString());
console.log("startOfDayMs (UTC):", new Date(startOfDayMs).toISOString());
console.log("endOfDayMs (UTC):  ", new Date(endOfDayMs).toISOString());
console.log();

assert(
  startOfDayMs === Date.parse("2026-07-11T03:00:00.000Z"),
  "startOfDayMs = 00:00 BA (11 jul) = 03:00 UTC",
);
assert(
  endOfDayMs === Date.parse("2026-07-12T02:59:59.999Z"),
  "endOfDayMs = 23:59:59.999 BA (11 jul) = 02:59:59.999 UTC del 12",
);

const vence2359 = Date.parse("2026-07-12T02:59:00Z"); // 23:59 BA del 11
assert(
  vence2359 >= startOfDayMs && vence2359 <= endOfDayMs,
  "23:59 BA (11 jul) clasifica como PARA HOY",
);

const vence0001 = Date.parse("2026-07-12T03:01:00Z"); // 00:01 BA del 12
assert(vence0001 > endOfDayMs, "00:01 BA (12 jul) clasifica como PRÓXIMOS");

const vence0000 = Date.parse("2026-07-12T03:00:00.000Z"); // 00:00:00.000 BA del 12
assert(vence0000 > endOfDayMs, "00:00:00.000 BA (12 jul) clasifica como PRÓXIMOS");
