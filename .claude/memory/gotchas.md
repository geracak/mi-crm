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
