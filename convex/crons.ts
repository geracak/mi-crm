import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Nombre en ASCII: Convex exige "letras ASCII sin caracteres de control" en el
// identificador del cron (sin tildes/eñes).
crons.interval(
  "limpiar authVerifiers huerfanos de intentos de Google rechazados",
  { hours: 1 },
  internal.authMaintenance.limpiarVerifiersHuerfanos,
);

export default crons;
