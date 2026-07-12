# Vibe CRM

CRM para un pequeño negocio de ventas digitales: organizar clientes y no perder ventas por falta de seguimiento.

- **Stack:** Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 + Convex (+ Convex Auth).
- **Diseño:** ver [`design/design.md`](./design/design.md) (tokens) y [`design/design_handoff_crm_pwa/`](./design/design_handoff_crm_pwa) (prototipo y especificación pantalla por pantalla).
- **Planificación:** equipo `Talent-academy` en Linear, proyectos **CRM-MVP** y **CRM-RESTOPRD**.

## Empezar en local

```bash
npm install
npx convex dev      # backend: vincula/crea el deployment y genera .env.local
npm run dev         # frontend: http://localhost:3000
```

Hacen falta los dos procesos a la vez (Convex y Next). El primer `npx convex dev` pide login e inicializa el deployment; a partir de ahí `convex/_generated` y `.env.local` (con `NEXT_PUBLIC_CONVEX_URL`) quedan listos.

### Usuarios (seed dev)

El registro público está cerrado a propósito. Los usuarios se crean con una función interna (dev-only):

```bash
npx convex run seed:sembrarUsuarios '{"martaPassword":"<pass>","carlosPassword":"<pass>"}'
```

Crea `marta@vibecrm.local` (dueña) y `carlos@vibecrm.local` (comercial). Luego entra en `/login`.

## Estructura

```
convex/            Esquema, funciones y auth de Convex (_generated SÍ se versiona)
design/            Design system y prototipo de referencia (no es código a portar)
src/app/           Rutas (App Router). (app) = shell autenticado, (auth) = login
src/proxy.ts       Proxy (antes «middleware») — redirección optimista de sesión
src/components/    UI del design system, layout (sidebar/tabbar) y overlays
src/lib/           Utilidades (fechas locales, api de Convex, guard de auth, nav)
```

## Seguridad / auth (resumen)

- **Convex Auth** con proveedor Password. La tabla `users` lleva `rol` (`propietaria` | `comercial`).
- Defensa en capas: `src/proxy.ts` (redirección optimista) + `guardAuth()` server-side por página + `requireUsuario()` en cada función Convex (exige sesión y rol válido). El registro público no puede autoasignarse rol.
- `/equipo` comprueba el rol server-side (solo la dueña).

## Despliegue

### Backend — Convex (se despliega aparte)

```bash
npx convex deploy            # despliega funciones + esquema al deployment de producción
```

En ese deployment de producción hay que dejar configurado **Convex Auth** una sola vez:

```bash
npx @convex-dev/auth --prod --web-server-url https://<tu-dominio-railway>
```

Esto fija `SITE_URL`, `JWT_PRIVATE_KEY` y `JWKS` en producción. `SITE_URL` debe ser el dominio público (el de Railway).

### Frontend — Railway (publicación automática desde GitHub)

Railway construye con Nixpacks (`railway.json`): `npm run build` → `npm run start` (Next.js respeta la variable `PORT`). En **Variables** de Railway define:

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | URL del deployment de Convex de producción (`https://<algo>.convex.cloud`) |

Con GitHub conectado, cada push a `main` dispara build + deploy. `convex/_generated` está versionado, así que `npm run build` es reproducible sin credenciales de Convex.

> **Nota:** con esta configuración el backend Convex NO se despliega desde Railway; actualízalo con `npx convex deploy` cuando cambien las funciones o el esquema.
