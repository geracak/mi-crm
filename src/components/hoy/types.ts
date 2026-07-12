import type { Doc } from "../../../convex/_generated/dataModel";

export interface SeguimientoConRelaciones extends Doc<"seguimientos"> {
  cliente: Doc<"clientes"> | null;
  responsable: Doc<"users"> | null;
}
