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

---

## 2026-07-29 · Mergear a master NO despliega Convex: producción quedó rota

**Categoría:** despliegue / infraestructura — **BLOQUEANTE, llegó a producción**

**Qué pasó:** tras mergear el PR de GER-219, `/equipo` dejó de cargar en
producción (`red-24.com`). El navegador mostraba la pantalla de Chrome «This
page couldn't load» y ni siquiera abría F12: se moría el proceso del renderer.

Los logs HTTP de Railway mostraban `GET /equipo 200` en 90-280 ms, o sea que
el servidor respondía perfecto. El diagnóstico salió de comparar las funciones
desplegadas en cada entorno:

```
$ npx convex function-spec --prod | grep usuarios
usuarios.js:actual      ← vieja, existe
usuarios.js:listar      ← vieja, existe
                        ← NO estaban equipo, invitar, actualizar ni eliminar
```

**Causa raíz:** `railway.json` tiene `buildCommand: "npm run build"`, que es
solo `next build`. **Eso no despliega Convex.** Los dos despliegues son
independientes: Railway sirve el frontend y Convex vive aparte. Durante la
verificación de la issue solo se corrió `npx convex dev --once`, que despliega
al deployment de **dev** (`kindred-elephant-599`), nunca a **prod**
(`affable-vulture-315`).

Resultado: Railway sirvió el frontend nuevo, que llama a `usuarios:equipo`,
contra un backend que no tenía esa función. La página renderiza bien en el
servidor (su `page.tsx` solo usa `usuarios:actual`, que sí existía — de ahí el
200 engañoso en los logs), pero al hidratar, el cliente de Convex pide una
función inexistente y entra en un ciclo de reconexión que termina tumbando la
pestaña por consumo de memoria.

**Por qué el síntoma despista:** un 200 en los logs del host NO significa que
la página funcione. Todo lo que pasa después de la hidratación (o sea, todas
las queries de Convex) es invisible para los logs HTTP de Railway.

**Regla preventiva:** cualquier cambio que toque `convex/` necesita su propio
despliegue a producción. Antes de decir que algo está listo para probar en el
servidor:

```bash
npx convex function-spec --prod | grep -o '"identifier": "[^"]*"' | sort
```

y confirmar que las funciones nuevas están ahí. `npx convex deploy --dry-run
--yes` valida el push sin aplicarlo (avisa si borra índices y valida el schema
contra los datos reales de prod).

**Arreglo estructural (pendiente de aplicar):** mover el despliegue de Convex
dentro del build de Railway, que es el patrón que documenta Convex para hosts
externos:

```json
// railway.json
"buildCommand": "npx convex deploy --cmd 'npm run build'"
```

Despliega el backend ANTES de construir el frontend, así que es imposible que
salga a producción un frontend que llame funciones que el backend no tiene.
Requiere `CONVEX_DEPLOY_KEY` en las variables de Railway (dashboard de Convex
→ deployment de producción → *Deployment Settings* → pestaña *General* →
botón *Generate Production Deploy Key*, con el permiso `deployment:deploy`).

**Verificación:** `/equipo` volvió a funcionar tras `npx convex deploy --yes`,
confirmado ejecutando la query real contra prod:
`npx convex run usuarios:equipo '{}' --prod --identity '{"subject":"<id>|x"}'`.

---

## 2026-07-29 · `grep … | head -1 && echo "OK"` SIEMPRE dice OK

**Categoría:** shell / verificación — **el peor tipo de error: confirmar algo falso**

**Qué pasó:** para comprobar que existía `CONVEX_DEPLOY_KEY` en Railway se corrió:

```bash
railway variables --json | grep -o '"CONVEX_DEPLOY_KEY"' | head -1 \
  && echo "--> variable PRESENTE" || echo "--> NO aparece"
```

Imprimió **"variable PRESENTE"** y se le reportó a Gerardo que la variable estaba
puesta. No estaba. El build de Railway falló después con
`No CONVEX_DEPLOYMENT set`, y al listar los nombres apareció que la variable se
había creado con el nombre literal `convex deploy` en lugar de
`CONVEX_DEPLOY_KEY`.

**Causa raíz:** el código de salida de una tubería es el del ÚLTIMO comando, y
`head -1` termina en 0 aunque no reciba una sola línea. El `&&` nunca miró a
`grep`. La comprobación no podía fallar: habría dicho "PRESENTE" con cualquier
cosa, incluso con el servicio inexistente.

**Regla preventiva:** para "¿existe X?" usar `grep -c` y comparar el número, o
`grep -q` a secas. **Nunca** encadenar un filtro después del `grep` cuyo código
de salida se está usando:

```bash
# MAL — head/tail/sort/cut/wc devuelven 0 siempre, tapan al grep
cmd | grep -o 'X' | head -1 && echo "existe"

# BIEN — el número es el dato, no el código de salida
test "$(cmd | grep -c '^X=')" -ge 1 && echo "existe"

# BIEN — grep -q es el último de la tubería, su código sí manda
cmd | grep -q '^X=' && echo "existe"
```

**Regla más general (la que de verdad importa):** una verificación que no puede
dar negativo no es una verificación. Antes de reportar un check en verde,
preguntarse *"¿qué tendría que pasar para que esto diera rojo?"* — y cuando sea
barato, **correr el control negativo**. En esta misma sesión sirvió dos veces:

- el vencimiento de códigos se probó con fecha pasada (rechaza) **y** con fecha
  futura + código incorrecto (error distinto), lo que demuestra que discrimina
  en vez de rechazar todo;
- la clave de despliegue nueva se validó con un dry-run que funcionó **y** con
  una clave inventada que dio 401, lo que demuestra que el dry-run realmente usa
  la clave y no las credenciales locales de quien lo corre.

**Coste real:** dos builds de producción fallidos y una ronda entera de
diagnóstico sobre una premisa falsa que yo mismo había afirmado.

---

## 2026-07-29 · Los mensajes de error de `convex deploy` dicen en qué escalón estás

**Categoría:** despliegue / diagnóstico

**Qué se aprendió:** al integrar `npx convex deploy --cmd 'npm run build'` en el
build de Railway, los dos fallos consecutivos dieron mensajes DISTINTOS, y esa
diferencia es el diagnóstico:

| Mensaje | Significa |
|---|---|
| `✖ No CONVEX_DEPLOYMENT set, run npx convex dev…` | `CONVEX_DEPLOY_KEY` no llegó al proceso (falta, mal nombrada, o no expuesta al build) |
| `401 Unauthorized: AuthenticationFailed: Invalid Convex deploy key` | La variable SÍ llegó; la clave es inválida o fue revocada |

Pasar del primero al segundo es progreso, no un fallo nuevo.

**How to apply:** la deploy key se puede generar **desde el CLI**, no hace falta
el dashboard: `npx convex deployment token create <nombre> --prod`. Con
`--save-env <ruta>` la escribe a un archivo en vez de imprimirla — usar siempre
esa forma, con la ruta FUERA del repo (scratchpad), y borrar el archivo después.
Para cargarla en Railway sin que pase por pantalla ni por el historial:

```bash
grep '^CONVEX_DEPLOY_KEY=' "$RUTA/clave.env" | cut -d= -f2- \
  | railway variable set CONVEX_DEPLOY_KEY --stdin --skip-deploys
```

Y para relanzar el build sobre el commit nuevo (no sobre el deployment activo,
que tras un fallo es el viejo): `railway redeploy --from-source -y`.

---

## 2026-07-31 · Un `.mjs` en el scratchpad no resuelve las dependencias del proyecto

**Categoría:** tooling / Node

**Qué pasó:** al escribir una prueba desechable que importa `convex/browser`, se guardó en el
directorio scratchpad de la sesión y se ejecutó desde ahí. Node falló con
`ERR_MODULE_NOT_FOUND: Cannot find package 'convex'`.

**Causa raíz:** la resolución de módulos ESM sube por el árbol de directorios desde el
ARCHIVO, no desde el `cwd`. Un script fuera del repo nunca ve su `node_modules`, y `NODE_PATH`
no aplica a ESM.

**Regla preventiva:** un script desechable que importe dependencias del proyecto va DENTRO del
repo (`./_tmp-*.mjs`), se ejecuta y se borra en el mismo comando:

```bash
cp "$SCRATCH/prueba.mjs" ./_tmp-prueba.mjs && node ./_tmp-prueba.mjs; rm -f ./_tmp-prueba.mjs
```

El scratchpad sigue siendo el sitio correcto para lo que NO importa dependencias.

**Verificación:** `git status --short` sin rastro del `_tmp-*` antes de commitear.
