/**
 * GER-238 — Test negativo permanente de la lista blanca de orígenes de
 * redirección (`convex/redirectOrigins.ts`).
 *
 * Por qué existe: el callback `redirect` de Convex Auth solo corre dentro del
 * callback de OAuth, que no es alcanzable sin completar un intercambio real con
 * Google (`@convex-dev/auth/dist/server/implementation/index.js:186-190`). Sin
 * este script, la única forma de ejercitar la validación sería hacer un login
 * de verdad, y los casos que importan —los rechazos— no se pueden provocar
 * desde el navegador.
 *
 * Qué protege: que un `redirectTo` con un origen ajeno no pueda completar el
 * login. Sin esa garantía sería un open redirect — un enlace que arranca en un
 * dominio nuestro y deposita a la persona autenticada, con su código, en un
 * dominio de terceros.
 *
 * Compila el módulo real con `tsc` y lo importa: se ejercita el fuente, no una
 * copia. No usa dependencias nuevas.
 *
 * Código de salida: 0 = todos los casos correctos · 1 = alguno falla.
 *
 * Uso:  node scripts/probar-origenes.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const TSC = join(RAIZ, "node_modules", "typescript", "bin", "tsc");

const salida = mkdtempSync(join(tmpdir(), "ger238-"));
try {
  execFileSync(
    process.execPath,
    [
      TSC,
      join(RAIZ, "convex", "redirectOrigins.ts"),
      "--outDir", salida,
      "--module", "esnext",
      "--target", "es2022",
      "--moduleResolution", "bundler",
    ],
    { cwd: RAIZ, stdio: ["ignore", "inherit", "inherit"] },
  );

  const modulo = await import(
    pathToFileURL(join(salida, "redirectOrigins.js")).href
  );
  const { origenesPermitidos, resolverDestino } = modulo;

  // Valores de forma realista; el contenido concreto no importa para la lógica.
  const SITE_URL = "https://mi-crm-production-0600.up.railway.app";
  const ADICIONALES = "https://red-24.com";
  const permitidos = origenesPermitidos(SITE_URL, ADICIONALES);

  console.log(`Orígenes permitidos: ${[...permitidos].join("  ·  ")}\n`);

  const casos = [
    ["origen de SITE_URL", `${SITE_URL}/login`, "acepta"],
    ["origen de la lista blanca", "https://red-24.com/login", "acepta"],
    ["lista blanca con query", "https://red-24.com/login?x=1", "acepta"],
    ["ruta relativa", "/login", "acepta"],
    ["query relativa", "?error=1", "acepta"],
    ["dominio ajeno", "https://atacante-falso.example/login", "rechaza"],
    ["prefijo tramposo", "https://red-24.com.atacante-falso.example/", "rechaza"],
    ["credenciales embebidas", "https://red-24.com@atacante-falso.example/", "rechaza"],
    ["mismo host, esquema http", "http://red-24.com/login", "rechaza"],
    ["mismo host, otro puerto", "https://red-24.com:8443/login", "rechaza"],
    ["www sin dar de alta", "https://www.red-24.com/login", "rechaza"],
    ["esquema javascript", "javascript:alert(1)", "rechaza"],
    ["protocol-relative", "//atacante-falso.example/login", "rechaza"],
    ["protocol-relative con contrabarra", "/\\atacante-falso.example/login", "rechaza"],
    ["destino vacío", "", "rechaza"],
  ];

  let fallos = 0;
  for (const [etiqueta, redirectTo, esperado] of casos) {
    let real, detalle;
    try {
      detalle = resolverDestino(redirectTo, SITE_URL, permitidos);
      real = "acepta";
    } catch (error) {
      real = "rechaza";
      detalle = error.message;
    }
    const ok = real === esperado;
    if (!ok) fallos++;
    console.log(
      `${ok ? "  ok  " : "FALLA "} ${etiqueta.padEnd(34)} ${real.padEnd(8)} ${detalle.slice(0, 62)}`,
    );
  }

  console.log(`\n${casos.length - fallos}/${casos.length} correctos`);
  process.exit(fallos === 0 ? 0 : 1);
} finally {
  rmSync(salida, { recursive: true, force: true });
}
