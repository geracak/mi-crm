# Gotchas del proyecto

Errores cometidos en sesiones de trabajo, con su causa raíz y la regla que los evita.
Se revisa al inicio de cada sesión, junto con `MEMORY.md`.

---

## 2026-07-29 · Here-string de PowerShell dentro de la herramienta Bash

**Categoría:** tooling / shell

**Qué pasó:** al escribir el mensaje de commit de GER-219 se usó `git commit -m @'...'@`
(sintaxis de here-string de PowerShell) desde la herramienta **Bash**. Bash no conoce esa
sintaxis: pasó el `@` como parte literal del texto y el commit quedó con el asunto
`@ feat(equipo): ...` y un `@` suelto al final del cuerpo. Hubo que hacer `--amend`.

**Causa raíz:** el entorno expone dos shells con sintaxis distinta (PowerShell y Git Bash) y
se mezcló la sintaxis de uno con la herramienta del otro.

**Regla preventiva:** para mensajes multilínea, usar el heredoc que corresponde a la
herramienta que se está invocando:

- Herramienta **Bash** → `git commit -F - <<'MSGEOF' … MSGEOF` (el delimitador entre comillas
  simples evita que se expandan `$`, backticks y `!`).
- Herramienta **PowerShell** → `git commit -m @'…'@`, con el `'@` de cierre en la columna 0.

Nunca `-m` con here-strings; `-F -` es más predecible cuando el texto lleva backticks o acentos.

**Verificación:** después de cualquier commit con mensaje largo, comprobar el resultado con
`git log -1 --format=%s` antes de seguir.

---

## 2026-07-29 · `tsc` no reduce el chequeo de código inalcanzable tras un `throw`

**Categoría:** tooling / TypeScript

**Qué pasó:** al inyectar temporalmente un `throw` al inicio del handler de
`_marcarPasswordConfigurada` (para probar en vivo que un fallo de esa mutación
no rompe el login) quedó ANTES del `const u = await ctx.db.get(...)` y del
`if (u === null || u.passwordPendiente !== true)`. `npx convex dev --once`
falló el typecheck con `'u' is possibly 'null'` sobre una línea que en el
código real (sin el `throw`) compila bien y ya estaba en producción.

**Causa raíz:** el código después del `throw` sigue siendo código válido para
`tsc` — no se descarta del chequeo de tipos por ser inalcanzable en runtime —
pero mover el `throw` ANTES de una asignación (`const u = …`) altera el orden
en que el analizador de flujo ve declarada esa variable en ese punto del
archivo, y la narrowing de `u === null` que dependía de la posición original
dejó de aplicar tal como estaba escrita más abajo.

**Regla preventiva:** al inyectar un fallo temporal de prueba dentro de un
handler existente, colocar el `throw` DESPUÉS de todas las declaraciones y
narrowings de las que dependa el código siguiente (p. ej. después del `if` de
null-check), nunca antes. Si el `throw` es incondicional, correr `npx convex
dev --once` (o `npm run build`) inmediatamente después de escribirlo para
detectar el error de tipos antes de asumir que el fallo se desplegó.

**Verificación:** confirmar con `git diff` que la reversión del fallo
inyectado deja el archivo IDÉNTICO al commit real antes de redeployar el
código de producción.

---

## 2026-07-29 · Probar acciones autenticadas de Convex Auth desde la CLI

**Categoría:** tooling / testing

**Qué se aprendió:** `npx convex run <función>` no lleva sesión: cualquier
función que dependa de `requireUsuario`/`requirePropietaria` (vía
`getAuthUserId`) falla con "No autenticado". Se puede simular una sesión real
con `--identity '{"subject":"<userId>|loquesea"}'` — `getAuthUserId` solo lee
la parte antes del primer `|` (`TOKEN_SUB_CLAIM_DIVIDER` en
`@convex-dev/auth/dist/server/implementation/utils.js`), así que el sufijo no
importa. Sirvió para invocar `usuarios:invitar` y `usuarios:eliminar` como la
propietaria del seed (`gera.cak@gmail.com`) sin pasar por el navegador.

**Cómo se usó (GER-219):** para probar el ciclo real de `passwordPendiente`
sin depender de un navegador conectado: invitar con un alias `+` de Gmail
(`gera.cak+algo@gmail.com`, mismo buzón, direcciones distintas para el
sistema) → `recuperacion:solicitarCodigo` manda el código real por Resend →
Gerardo lo lee de su correo y lo pasa → `auth:signIn` con
`flow: "reset-verification"` cierra el ciclo. El código de verificación se
guarda HASHEADO en `authVerificationCodes.code`: no hay forma de leerlo en
claro desde la base, hace falta el correo real.

**How to apply:** para cualquier prueba futura de flujos autenticados de este
proyecto sin UI, usar este patrón en vez de intentar simular tokens JWT a
mano. Borrar siempre las cuentas de prueba creadas (`usuarios:eliminar`) al
terminar, para no dejar basura en el deployment de dev.
