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

// GER-242: desde que la invitacion lleva el codigo dentro, toda alta y todo
// reenvio generan una fila en authVerificationCodes y no habia ningun cron que
// las podara. Borra por la ventana derivada (24 h invitacion / 15 min
// recuperacion), no por el expirationTime de la libreria, que es siempre el
// tope exterior de 24 h.
crons.interval(
  "limpiar codigos de verificacion vencidos",
  { hours: 1 },
  internal.authMaintenance.limpiarCodigosVencidos,
);

export default crons;
