import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { DEMO_USER_EMAIL } from "./users";

// ⚠️ DEV-ONLY, con autorización real (no un interruptor por env var):
// definidas como `internalMutation`, NO `mutation` - Convex no las expone en
// absoluto en la API pública (`api.*`), solo en `internal.*`. Ningún cliente
// (browser, ConvexReactClient, ConvexHttpClient con URL pública) puede
// invocarlas jamás, sin importar el deployment. Solo se pueden correr desde:
// (a) la CLI/dashboard de Convex autenticados como miembro del equipo del
// proyecto (`npx convex run seed:seedDemoData`), o (b) otra función del
// servidor que las llame explícitamente (no aplica acá). Este es el
// reemplazo real de la guardia anterior por variable de entorno que la
// auditoría había marcado como insuficiente (interruptor de deployment, no
// autorización) - el control de acceso ahora es estructural, impuesto por
// el framework, no por disciplina de proceso.
//
// ALLOW_DEV_SEED se mantiene como defensa en profundidad adicional (evita
// que un miembro del equipo con acceso legítimo a la CLI ejecute esto por
// error contra un deployment que no lo tenga seteado) - ver
// .env.local.example. Nunca setear en el deployment de producción.
function assertDevMutationsAllowed() {
  if (process.env.ALLOW_DEV_SEED !== "true") {
    throw new Error(
      "Mutation dev-only deshabilitada: falta ALLOW_DEV_SEED=true en este deployment.",
    );
  }
}

const DIA_MS = 24 * 60 * 60 * 1000;

export const seedDemoData = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertDevMutationsAllowed();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", DEMO_USER_EMAIL))
      .unique();
    if (existing) {
      return { skipped: true, reason: "El dataset demo ya existe" };
    }

    const marta = await ctx.db.insert("users", {
      name: "Marta",
      email: DEMO_USER_EMAIL,
      rol: "propietaria",
      isDemo: true,
    });

    const nombresClientes = [
      { nombre: "Juan Pérez", estado: "activo" },
      { nombre: "Ana Gómez", estado: "nuevo" },
      { nombre: "Carlos Ruiz", estado: "activo" },
      { nombre: "Lucía Fernández", estado: "en negociación" },
      { nombre: "Martín Silva", estado: "activo" },
      { nombre: "Sofía Torres", estado: "nuevo" },
      { nombre: "Diego Molina", estado: "en negociación" },
    ];

    const clienteIds = [];
    for (const c of nombresClientes) {
      clienteIds.push(
        await ctx.db.insert("clientes", {
          nombre: c.nombre,
          estado: c.estado,
          isDemo: true,
        }),
      );
    }

    const ahora = Date.now();
    const acciones = [
      "Llamar para confirmar pedido",
      "Enviar propuesta",
      "Seguimiento post-venta",
      "Coordinar reunión",
      "Confirmar datos de facturación",
    ];

    const offsetsDias = [-3, -1, 0, 0, 1, 3, 7, -5, 0, 2, -2, 5];
    for (let i = 0; i < offsetsDias.length; i++) {
      const cliente = clienteIds[i % clienteIds.length];
      await ctx.db.insert("seguimientos", {
        clienteId: cliente,
        accion: acciones[i % acciones.length],
        vence: ahora + offsetsDias[i] * DIA_MS,
        hecho: false,
        responsableId: marta,
        isDemo: true,
      });
    }

    return { skipped: false, userId: marta, clientes: clienteIds.length };
  },
});

// Mecanismo explícito para probar el gating de rol (ej. /equipo) sin login
// real: cambia el rol del ÚNICO usuario que `users.getCurrent` puede ver.
// No crea usuarios nuevos ni toca ningún otro campo.
export const setDemoUserRole = internalMutation({
  args: { rol: v.union(v.literal("propietaria"), v.literal("comercial")) },
  handler: async (ctx, { rol }) => {
    assertDevMutationsAllowed();
    const marta = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", DEMO_USER_EMAIL))
      .unique();
    if (!marta) {
      throw new Error(
        "No existe el usuario demo todavía - correr seedDemoData primero",
      );
    }
    await ctx.db.patch(marta._id, { rol });
    return { userId: marta._id, rol };
  },
});
