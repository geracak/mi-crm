# Vibe CRM

CRM responsive para pequeños negocios (Next.js 16 App Router + Convex + Tailwind CSS v4).

## Desarrollo local

```bash
npm install
npx convex dev    # deja esto corriendo en una terminal - watch de funciones/schema
npm run dev       # en otra terminal
```

Variables de entorno locales (`.env.local`, ver `.env.local.example`):

- `NEXT_PUBLIC_CONVEX_URL` / `CONVEX_DEPLOYMENT` - las genera `npx convex dev` la primera vez.
- `ALLOW_DEV_SEED` (variable de **deployment** de Convex, no de este archivo - se setea con `npx convex env set ALLOW_DEV_SEED true`) - habilita las mutations de datos de prueba en `convex/seed.ts`. **Nunca setear en el deployment de producción.**

Para poblar datos de prueba en el deployment de dev:

```bash
npx convex run seed:seedDemoData
```

## Deploy en Railway

El build de este repo está configurado para desplegar las funciones de Convex a **producción** y buildear Next.js en un solo paso (`package.json` → `"build": "convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd \"next build\""`). Railway detecta el proyecto Node/Next.js automáticamente (Nixpacks); `railway.json` fija el comando de arranque.

**Configuración única requerida en Railway** (Settings → Variables del servicio):

- `CONVEX_DEPLOY_KEY` - deploy key del deployment de **producción** de Convex. Se genera desde el [dashboard de Convex](https://dashboard.convex.dev) → proyecto → Settings → Deploy Keys → Production. Con esta variable seteada, cada build de Railway ejecuta `convex deploy`, que sube schema/funciones a producción e inyecta automáticamente `NEXT_PUBLIC_CONVEX_URL` (no hace falta setearla a mano).

No setear `ALLOW_DEV_SEED` en el deployment de producción de Convex - las mutations de `convex/seed.ts` son solo para desarrollo local (ver comentario en ese archivo).

## Stack

- Next.js 16 (App Router, Turbopack) + TypeScript estricto
- Convex (backend/datos en tiempo real)
- Tailwind CSS v4 (tokens de diseño en `src/app/globals.css`, portados desde `design/`)
