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

// GER-239: `recuperacionThrottle` la escribe una acción PUBLICA (sin sesion),
// asi que nada impide que alguien la haga crecer con correos inventados.
crons.interval(
  "limpiar throttle vencido de recuperacion de contrasena",
  { hours: 1 },
  internal.recuperacion.limpiarThrottleAntiguo,
);

export default crons;
