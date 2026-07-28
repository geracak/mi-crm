/**
 * GER-240 — Reproducción y test negativo permanente del hallazgo A1 de la
 * auditoría de seguridad del login (27/07/2026).
 *
 * A1: `api.auth.signIn` es una acción PÚBLICA de Convex y su rama
 * `flow: "signUp"` verificaba la contraseña de una cuenta existente SIN
 * consultar `authRateLimits`
 * (@convex-dev/auth/dist/server/implementation/mutations/createAccountFromCredentials.js:23-40),
 * mientras que `flow: "signIn"` sí aplica el límite de 10 fallos/hora
 * (.../retrieveAccountWithCredentials.js:26-33). Resultado: intentos de
 * contraseña ilimitados, sin rastro, y sesión válida al acertar.
 *
 * Este script llama a `auth:signIn` DIRECTO contra el deployment, sin pasar por
 * la interfaz ni por el proxy de Next: es exactamente lo que haría un atacante
 * que solo conoce `NEXT_PUBLIC_CONVEX_URL` (viaja en el bundle del navegador).
 *
 * ⚠️ SOLO CONTRA EL DEPLOYMENT DE DESARROLLO. Aborta si `CONVEX_DEPLOYMENT` no
 * empieza por `dev:`.
 *
 * ⚠️ EL VEREDICTO NO PUEDE LEER MENSAJES DE ERROR. Convex censura el texto de
 * los `Error` normales fuera de desarrollo local y devuelve "Server Error", así
 * que buscar "TooManyFailedAttempts" en el mensaje da un falso negativo SIEMPRE
 * (comprobado en la corrida del baseline: el límite había actuado y el mensaje
 * no lo decía). Los oráculos fiables son otros dos:
 *   1. `ConvexError`, cuyo `data` SÍ llega al cliente — es lo que usa el
 *      rechazo de `signUp`.
 *   2. la tabla `authRateLimits` leída con `npx convex data`, que dice si el
 *      camino registró el intento o no lo tocó.
 *
 * Código de salida: 0 = vector CERRADO · 1 = vector ABIERTO (o fallo de la
 * comprobación). Así sirve de test negativo en verde/rojo.
 *
 * Uso:
 *   REPRO_PASSWORD_CORRECTA="..." node scripts/repro-a1.mjs
 *
 * La contraseña se pasa por variable de entorno a propósito: en `argv` quedaría
 * visible para cualquier proceso que liste la tabla de procesos.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const signIn = makeFunctionReference("auth:signIn");

/** Cuenta objetivo de las pruebas de fuerza bruta por `signUp`. */
const EMAIL_OBJETIVO = "gera.cak@gmail.com";

/**
 * Cuenta usada SOLO para comprobar que el límite legítimo de `flow:"signIn"`
 * sigue vivo. Es otra a propósito: esa prueba agota el presupuesto de intentos
 * y, una vez agotado, ni la contraseña correcta entra hasta que se regenera
 * (~10/hora). Quemar la cuenta de la propietaria dejaría el login de desarrollo
 * inutilizable durante un buen rato.
 */
const EMAIL_SACRIFICABLE = "carlos@vibecrm.local";

const EMAIL_INEXISTENTE = "no-existe-jamas-2026@vibecrm.local";
const PASSWORD_INCORRECTA = "contrasena-incorrecta-a-proposito-000";
const RECHAZO_ESPERADO = "Registro no permitido";
const INTENTOS = 20;

function leerEnvLocal() {
  const texto = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const vars = {};
  for (const linea of texto.split("\n")) {
    const limpia = linea.trim();
    if (limpia === "" || limpia.startsWith("#")) continue;
    const corte = limpia.indexOf("=");
    if (corte === -1) continue;
    vars[limpia.slice(0, corte).trim()] = limpia
      .slice(corte + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return vars;
}

/**
 * Lee una tabla del deployment como JSON. El oráculo que no se puede censurar.
 *
 * Se invoca el CLI de Convex por su entrada de Node en vez de por `npx`: en
 * Windows, Node ≥ 20.12 rechaza con EINVAL el spawn de un `.cmd` sin shell, y
 * meter un shell por medio traería problemas de comillas en las rutas con
 * espacios (esta misma, «vibe coding», los tiene).
 */
const CLI_CONVEX = fileURLToPath(
  new URL("../node_modules/convex/bin/main.js", import.meta.url),
);

function leerTabla(tabla) {
  const salida = execFileSync(
    process.execPath,
    [CLI_CONVEX, "data", tabla, "--format", "json", "--limit", "100"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 * 1024 * 1024 },
  );
  const inicio = salida.indexOf("[");
  if (inicio === -1) return [];
  return JSON.parse(salida.slice(inicio));
}

const idDeCuenta = (cuentas, email) =>
  cuentas.find((c) => c.provider === "password" && c.providerAccountId === email)?._id ?? null;

const filaLimite = (limites, identificador) =>
  limites.find((l) => l.identifier === identificador) ?? null;

/**
 * Ejecuta una llamada y devuelve un resultado uniforme, sin lanzar: lo que
 * interesa es COMPARAR respuestas, no abortar en la primera.
 */
async function llamar(cliente, params) {
  try {
    const r = await cliente.action(signIn, { provider: "password", params });
    return { ok: true, tokens: r?.tokens ?? null, error: null };
  } catch (err) {
    return {
      ok: false,
      tokens: null,
      error: {
        nombre: err?.constructor?.name ?? "desconocido",
        data: err?.data ?? null,
        mensaje: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/** ¿Es el rechazo uniforme del wrapper? `ConvexError.data` sí viaja al cliente. */
const esRechazoUniforme = (e) => e !== null && e.data === RECHAZO_ESPERADO;

/**
 * Quita del mensaje los metadatos que cambian en cada llamada. Convex antepone
 * un `[Request ID: …]` distinto por petición, así que comparar el mensaje en
 * crudo daría SIEMPRE "distinguibles" aunque el error fuese idéntico — un falso
 * positivo de enumeración.
 */
const mensajeEstable = (m) =>
  (m ?? "").replace(/\[Request ID: [^\]]*\]/g, "").replace(/\s+/g, " ").trim();

const resumir = (e) =>
  e === null
    ? "(sin error)"
    : `${e.nombre}: ${(e.data ?? e.mensaje ?? "").toString().split("\n")[0].slice(0, 110)}`;

async function main() {
  const env = leerEnvLocal();

  if (!(env.CONVEX_DEPLOYMENT ?? "").startsWith("dev:")) {
    console.error(
      `ABORTADO: CONVEX_DEPLOYMENT no es de desarrollo (empieza por "${(env.CONVEX_DEPLOYMENT ?? "").split(":")[0]}:"). Este script no se corre nunca contra producción.`,
    );
    process.exit(1);
  }
  const url = env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    console.error("ABORTADO: falta NEXT_PUBLIC_CONVEX_URL en .env.local");
    process.exit(1);
  }
  const passwordCorrecta = process.env.REPRO_PASSWORD_CORRECTA;
  if (!passwordCorrecta) {
    console.error(
      "ABORTADO: falta REPRO_PASSWORD_CORRECTA. Fijala a la contraseña de desarrollo de la cuenta objetivo\n" +
        "(se establece con: npx convex run seed:resetearPasswords '{\"password\":\"...\"}').",
    );
    process.exit(1);
  }

  const cliente = new ConvexHttpClient(url);
  console.log(`Deployment: ${env.CONVEX_DEPLOYMENT}\n`);

  const cuentas = leerTabla("authAccounts");
  const idObjetivo = idDeCuenta(cuentas, EMAIL_OBJETIVO);
  const idSacrificable = idDeCuenta(cuentas, EMAIL_SACRIFICABLE);
  if (idObjetivo === null || idSacrificable === null) {
    console.error(
      `ABORTADO: faltan cuentas de prueba en el deployment (${EMAIL_OBJETIVO} / ${EMAIL_SACRIFICABLE}).\n` +
        "Sembralas con: npx convex run seed:sembrarUsuarios '{\"martaPassword\":\"...\",\"carlosPassword\":\"...\"}'",
    );
    process.exit(1);
  }

  let vectorAbierto = false;

  // ── A · Fuerza bruta por `flow:"signUp"` con contraseña incorrecta ────────
  console.log(`A · ${INTENTOS} × signUp con contraseña INCORRECTA contra ${EMAIL_OBJETIVO}`);
  const limiteAntesA = filaLimite(leerTabla("authRateLimits"), idObjetivo);
  const erroresA = [];
  for (let i = 0; i < INTENTOS; i++) {
    const r = await llamar(cliente, {
      email: EMAIL_OBJETIVO,
      password: PASSWORD_INCORRECTA,
      flow: "signUp",
    });
    erroresA.push(r.error);
  }
  const limiteDespuesA = filaLimite(leerTabla("authRateLimits"), idObjetivo);
  const rechazadasA = erroresA.filter(esRechazoUniforme).length;
  const tocoLaTablaA =
    (limiteAntesA?.lastAttemptTime ?? null) !== (limiteDespuesA?.lastAttemptTime ?? null);

  console.log(`   primera : ${resumir(erroresA[0])}`);
  console.log(`   última  : ${resumir(erroresA[erroresA.length - 1])}`);
  console.log(`   rechazadas con "${RECHAZO_ESPERADO}": ${rechazadasA}/${INTENTOS}`);
  console.log(
    `   authRateLimits del objetivo: lastAttemptTime ${tocoLaTablaA ? "AVANZÓ" : "SIN TOCAR"}` +
      ` (attemptsLeft ${limiteAntesA?.attemptsLeft ?? "(sin fila)"} → ${limiteDespuesA?.attemptsLeft ?? "(sin fila)"})`,
  );
  if (rechazadasA === INTENTOS) {
    console.log("   ✅ todas rechazadas antes de verificar la contraseña\n");
  } else {
    console.log(
      `   🔴 ${INTENTOS - rechazadasA}/${INTENTOS} llegaron a verificar contraseña sin rechazo uniforme\n`,
    );
    vectorAbierto = true;
  }

  // ── B · El camino de éxito del exploit: contraseña CORRECTA por signUp ────
  console.log(`B · 1 × signUp con contraseña CORRECTA contra ${EMAIL_OBJETIVO}`);
  const sesionesAntes = leerTabla("authSessions").length;
  const b = await llamar(cliente, {
    email: EMAIL_OBJETIVO,
    password: passwordCorrecta,
    flow: "signUp",
  });
  const sesionesDespues = leerTabla("authSessions").length;
  console.log(`   respuesta      : ${b.tokens ? "DEVOLVIÓ TOKENS" : resumir(b.error)}`);
  console.log(`   authSessions   : ${sesionesAntes} → ${sesionesDespues}`);
  if (b.tokens || sesionesDespues > sesionesAntes) {
    console.log("   🔴 la ruta de registro emitió una sesión válida\n");
    vectorAbierto = true;
  } else if (esRechazoUniforme(b.error)) {
    console.log("   ✅ rechazada con el mismo error, sin sesión nueva\n");
  } else {
    console.log("   🔴 no emitió sesión, pero el rechazo NO es el uniforme\n");
    vectorAbierto = true;
  }

  // ── C · El límite legítimo de `flow:"signIn"` sigue vivo ──────────────────
  // Oráculo: la tabla, no el mensaje. Se comprueba que el camino REGISTRA el
  // intento (lastAttemptTime avanza) y que el presupuesto queda agotado.
  console.log(`C · ${INTENTOS} × signIn con contraseña INCORRECTA contra ${EMAIL_SACRIFICABLE}`);
  const limiteAntesC = filaLimite(leerTabla("authRateLimits"), idSacrificable);
  for (let i = 0; i < INTENTOS; i++) {
    await llamar(cliente, {
      email: EMAIL_SACRIFICABLE,
      password: PASSWORD_INCORRECTA,
      flow: "signIn",
    });
  }
  const limiteDespuesC = filaLimite(leerTabla("authRateLimits"), idSacrificable);
  const registro =
    (limiteAntesC?.lastAttemptTime ?? 0) !== (limiteDespuesC?.lastAttemptTime ?? 0) ||
    (limiteAntesC === null && limiteDespuesC !== null);
  // El presupuesto agotado es la aserción; que `lastAttemptTime` avance es solo
  // informativo y NO puede exigirse: una vez bloqueada la cuenta,
  // `isSignInRateLimited` corta ANTES de `recordFailedSignIn`
  // (retrieveAccountWithCredentials.js:26-31), así que la marca deja de moverse
  // precisamente cuando el límite está haciendo su trabajo.
  const agotado = limiteDespuesC !== null && limiteDespuesC.attemptsLeft < 1;
  console.log(
    `   authRateLimits: attemptsLeft ${limiteAntesC?.attemptsLeft ?? "(sin fila)"} → ${limiteDespuesC?.attemptsLeft ?? "(sin fila)"}` +
      ` · lastAttemptTime ${registro ? "AVANZÓ" : "sin tocar (ya bloqueada)"}`,
  );
  if (agotado) {
    console.log("   ✅ el límite legítimo está actuando (presupuesto agotado)\n");
  } else {
    console.log("   🔴 el límite legítimo NO está actuando\n");
    vectorAbierto = true;
  }

  // ── D · Oráculo de enumeración (hallazgo A2) ──────────────────────────────
  console.log("D · signUp: correo INEXISTENTE vs. correo EXISTENTE");
  const dNuevo = await llamar(cliente, {
    email: EMAIL_INEXISTENTE,
    password: PASSWORD_INCORRECTA,
    flow: "signUp",
  });
  const dExiste = await llamar(cliente, {
    email: EMAIL_OBJETIVO,
    password: PASSWORD_INCORRECTA,
    flow: "signUp",
  });
  console.log(`   inexistente : ${resumir(dNuevo.error)}`);
  console.log(`   existente   : ${resumir(dExiste.error)}`);
  const iguales =
    dNuevo.error?.nombre === dExiste.error?.nombre &&
    JSON.stringify(dNuevo.error?.data) === JSON.stringify(dExiste.error?.data) &&
    mensajeEstable(dNuevo.error?.mensaje) === mensajeEstable(dExiste.error?.mensaje);
  if (iguales) {
    console.log("   ✅ indistinguibles (tipo, data y mensaje coinciden)\n");
  } else {
    console.log("   🔴 DISTINGUIBLES — sirve de oráculo para enumerar cuentas\n");
    vectorAbierto = true;
  }

  console.log("─".repeat(70));
  if (vectorAbierto) {
    console.log("VEREDICTO: 🔴 VECTOR ABIERTO — A1/A2 explotables");
    process.exit(1);
  }
  console.log("VEREDICTO: ✅ VECTOR CERRADO");
  process.exit(0);
}

await main();
