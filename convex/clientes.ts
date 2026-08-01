import { v, ConvexError } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUsuario } from "./authz";
import { normalizarEmail } from "./emailUtils";
import { emailClienteOpcional } from "./validaciones";

export const ESTADO_CLIENTE = v.union(
  v.literal("nuevo_lead"),
  v.literal("en_negociacion"),
  v.literal("ganado"),
  v.literal("perdido"),
);

export const CANAL_ORIGEN = v.union(
  v.literal("web"),
  v.literal("redes"),
  v.literal("email"),
  v.literal("whatsapp"),
);

/**
 * GER-249 — Regla de estado (schema.ts), extraída a función PURA: recibe las ventas
 * ya leídas y no toca la base. La comparte `estadoDe` (una consulta por cliente) y
 * `listarConEstado` (una consulta agrupada para todos), así que las dos vías no
 * pueden divergir — es literalmente la misma función.
 */
export function estadoDesdeVentas(ventas: Doc<"ventas">[]) {
  if (ventas.length === 0) return "nuevo_lead" as const;
  if (ventas.some((x) => x.estado === "abierta")) return "en_negociacion" as const;
  if (ventas.some((x) => x.estado === "ganada")) return "ganado" as const;
  return "perdido" as const;
}

/**
 * Estado calculado del cliente a partir de sus ventas (regla en schema.ts).
 * No es una función pública; se reutiliza desde otras funciones Convex.
 */
export async function estadoDe(ctx: QueryCtx, clienteId: Id<"clientes">) {
  const ventas = await ctx.db
    .query("ventas")
    .withIndex("by_cliente_fecha", (q) => q.eq("clienteId", clienteId))
    .collect();
  return estadoDesdeVentas(ventas);
}

/** Lista mínima de clientes para los selectores (Nueva tarea, etc.). */
export const listar = query({
  args: {},
  returns: v.array(v.object({ _id: v.id("clientes"), nombre: v.string() })),
  handler: async (ctx) => {
    await requireUsuario(ctx);
    const cs = await ctx.db.query("clientes").collect();
    return cs.map((c) => ({ _id: c._id, nombre: c.nombre }));
  },
});

/**
 * Lista de clientes con estado calculado y "último contacto", para /clientes (F3).
 *
 * GER-249 — El estado ya no cuesta una consulta a `ventas` POR CLIENTE: se lee la
 * tabla `ventas` una sola vez y se agrupa en memoria por `clienteId`. Es correcto
 * leer los mismos documentos que antes (ni uno más, ni uno menos) porque no hay
 * ventas huérfanas — `ventas.crear` valida el cliente antes de insertar y
 * `clienteId` nunca se modifica en `ventas.actualizar` — así que agrupar toda la
 * tabla encuentra exactamente las mismas ventas que `estadoDe` habría leído cliente
 * por cliente. Pasa de `1 + 2N` a `1 + N + 1` lecturas (clientes + ventas + la
 * `.first()` de interacciones por cliente, que queda fuera de esta entrega).
 *
 * Escala MVP: sigue con `collect()` de toda la tabla. Aceptable para decenas de
 * clientes; a cientos/miles habría que paginar o mover la búsqueda al servidor —
 * NO dejar este patrón como implícito si el volumen crece.
 *
 * "Último contacto" = la interacción más reciente, leída del índice compuesto
 * `by_cliente_fecha` en orden descendente (una sola fila, sin collect+reduce).
 */
export const listarConEstado = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("clientes"),
      nombre: v.string(),
      empresa: v.optional(v.string()),
      email: v.optional(v.string()),
      telefono: v.optional(v.string()),
      estado: ESTADO_CLIENTE,
      ultimoContacto: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    await requireUsuario(ctx);
    const [clientes, todasLasVentas] = await Promise.all([
      ctx.db.query("clientes").collect(),
      ctx.db.query("ventas").collect(),
    ]);
    const ventasPorCliente = new Map<Id<"clientes">, Doc<"ventas">[]>();
    for (const venta of todasLasVentas) {
      const grupo = ventasPorCliente.get(venta.clienteId);
      if (grupo) grupo.push(venta);
      else ventasPorCliente.set(venta.clienteId, [venta]);
    }
    const filas = await Promise.all(
      clientes.map(async (c) => {
        const estado = estadoDesdeVentas(ventasPorCliente.get(c._id) ?? []);
        const ultima = await ctx.db
          .query("interacciones")
          .withIndex("by_cliente_fecha", (q) => q.eq("clienteId", c._id))
          .order("desc")
          .first();
        const ultimoContacto = ultima?.fecha ?? null;
        return {
          _id: c._id,
          nombre: c.nombre,
          empresa: c.empresa,
          email: c.email,
          telefono: c.telefono,
          estado,
          ultimoContacto,
        };
      }),
    );
    filas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return filas;
  },
});

/**
 * Un cliente por id con su estado calculado, para la ficha (F2). `id` llega como
 * string (segmento de URL, no confiable) y se valida con `normalizeId`: cualquier id
 * inválido, de otra tabla o inexistente devuelve `null` — la ficha muestra "Cliente no
 * encontrado" en vez de propagar un error de argumento de Convex.
 */
export const obtener = query({
  args: { id: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("clientes"),
      nombre: v.string(),
      empresa: v.optional(v.string()),
      telefono: v.optional(v.string()),
      email: v.optional(v.string()),
      canalOrigen: v.optional(CANAL_ORIGEN),
      estado: ESTADO_CLIENTE,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await requireUsuario(ctx);
    const id = ctx.db.normalizeId("clientes", args.id);
    if (id === null) return null;
    const c = await ctx.db.get(id);
    if (c === null) return null;
    return {
      _id: c._id,
      nombre: c.nombre,
      empresa: c.empresa,
      telefono: c.telefono,
      email: c.email,
      canalOrigen: c.canalOrigen,
      estado: await estadoDe(ctx, c._id),
    };
  },
});

/**
 * GER-248 — Otro cliente que ya use este email, para avisar de un posible duplicado
 * ANTES de guardar. Devuelve `null` si no lo hay.
 *
 * El aviso es PRE-FLIGHT, no transaccional: dos altas simultáneas del mismo email
 * pueden guardarse ambas sin verlo. Se acepta porque la regla de producto es avisar,
 * no bloquear — el peor caso de esa carrera es un duplicado sin aviso, que es
 * exactamente lo que pasaba siempre antes de esta entrega.
 *
 * ⚠️ `normalizarEmail` aquí NO es cosmético: el índice guarda el email normalizado,
 * así que buscar el texto crudo haría que "ANA@x.com" no encontrase "ana@x.com" —
 * justo el caso que esta función existe para detectar. Normalizar solo en la interfaz
 * no vale: la clave de búsqueda tiene que llegar normalizada al índice.
 *
 * `requireUsuario` no es un detalle de estilo: sin él, cualquiera podría preguntar
 * "¿tenéis a esta persona como cliente?" y confirmar correos uno a uno.
 *
 * `take(2)` en vez de `unique()`: hoy nada impide que haya varios clientes con el
 * mismo email (de eso avisa), así que `unique()` lanzaría en el caso normal. Se leen
 * dos para poder descartar el propio documento al editar y quedarse con el otro.
 */
export const buscarPorEmail = query({
  args: {
    email: v.string(),
    excluirId: v.optional(v.id("clientes")),
  },
  returns: v.union(
    v.object({ _id: v.id("clientes"), nombre: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await requireUsuario(ctx);
    const email = normalizarEmail(args.email);
    if (email.length === 0) return null;
    const candidatos = await ctx.db
      .query("clientes")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(2);
    const otro = candidatos.find((c) => c._id !== args.excluirId);
    return otro ? { _id: otro._id, nombre: otro.nombre } : null;
  },
});

/** Alta rápida de cliente (F1, base). Requiere nombre y ≥1 medio de contacto. */
export const crear = mutation({
  args: {
    nombre: v.string(),
    empresa: v.optional(v.string()),
    telefono: v.optional(v.string()),
    email: v.optional(v.string()),
    canalOrigen: v.optional(CANAL_ORIGEN),
    nota: v.optional(v.string()),
  },
  returns: v.id("clientes"),
  handler: async (ctx, args) => {
    await requireUsuario(ctx);
    const nombre = args.nombre.trim();
    if (nombre.length === 0) throw new ConvexError("El nombre es obligatorio");
    const telefono = args.telefono?.trim() || undefined;
    const email = emailClienteOpcional(args.email);
    if (!telefono && !email) {
      throw new ConvexError("Indica al menos un teléfono o un email");
    }
    return await ctx.db.insert("clientes", {
      nombre,
      empresa: args.empresa?.trim() || undefined,
      telefono,
      email,
      canalOrigen: args.canalOrigen,
      nota: args.nota?.trim() || undefined,
    });
  },
});

/**
 * Edita los datos de contacto de un cliente (F2). NO toca `canalOrigen`/`nota` ni el
 * estado (calculado desde ventas). Misma regla que el alta: nombre + ≥1 medio de
 * contacto. `id` es `v.id` porque llega del doc ya cargado (fuente confiable), no de la URL.
 */
export const actualizar = mutation({
  args: {
    id: v.id("clientes"),
    nombre: v.string(),
    empresa: v.optional(v.string()),
    telefono: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireUsuario(ctx);
    const cliente = await ctx.db.get(args.id);
    if (cliente === null) throw new ConvexError("Cliente no encontrado");
    const nombre = args.nombre.trim();
    if (nombre.length === 0) throw new ConvexError("El nombre es obligatorio");
    const telefono = args.telefono?.trim() || undefined;
    const email = emailClienteOpcional(args.email);
    if (!telefono && !email) {
      throw new ConvexError("Indica al menos un teléfono o un email");
    }
    // patch con `undefined` borra el campo opcional (empresa/teléfono/email vaciados).
    await ctx.db.patch(args.id, {
      nombre,
      empresa: args.empresa?.trim() || undefined,
      telefono,
      email,
    });
    return null;
  },
});

/**
 * GER-248 — Migración de UNA SOLA VEZ: baja a minúsculas (y recorta) los emails
 * que ya estaban guardados antes de que el alta los normalizase.
 *
 * Sin esto, `buscarPorEmail` no vería las filas históricas: busca la clave
 * normalizada y solo casaría con las que ya lo estén.
 *
 * Se corre a mano tras cada despliegue, primero en dev y luego en prod:
 *   npx convex run clientes:normalizarEmailsExistentes
 * y se comprueba con `contarEmailsSinNormalizar`, que debe devolver 0.
 *
 * Es idempotente: correrla dos veces no cambia nada la segunda.
 *
 * Escala MVP: recorre la tabla entera, igual que `listarConEstado`. Es una
 * operación única y manual, no una ruta caliente.
 */
export const normalizarEmailsExistentes = internalMutation({
  args: {},
  returns: v.object({ revisados: v.number(), corregidos: v.number() }),
  handler: async (ctx) => {
    const todos = await ctx.db.query("clientes").collect();
    let corregidos = 0;
    for (const c of todos) {
      if (c.email === undefined) continue;
      const normalizado = normalizarEmail(c.email);
      if (normalizado === c.email) continue;
      // Un email que se queda en nada al normalizar era espacios en blanco:
      // se borra el campo en vez de guardar una cadena vacía.
      await ctx.db.patch(c._id, {
        email: normalizado.length === 0 ? undefined : normalizado,
      });
      corregidos++;
    }
    return { revisados: todos.length, corregidos };
  },
});

/**
 * GER-248 — Sonda de la migración: cuántos clientes tienen el email sin normalizar.
 * Debe dar 0 en cualquier momento posterior a esta entrega.
 *
 * Compara contra `normalizarEmail` y no contra `toLowerCase()` a secas para que el
 * conteo cubra también los espacios residuales que quita el `trim`.
 */
export const contarEmailsSinNormalizar = internalQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const todos = await ctx.db.query("clientes").collect();
    return todos.filter(
      (c) => c.email !== undefined && c.email !== normalizarEmail(c.email),
    ).length;
  },
});
