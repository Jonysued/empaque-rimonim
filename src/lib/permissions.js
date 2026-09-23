export const ROLES = [
  { value: "admin", label: "Administrador", description: "Acceso total" },
  { value: "supervisor", label: "Supervisor", description: "Acceso operativo total" },
  { value: "recepcion", label: "Recepción", description: "Ingreso de lotes y BINs" },
  { value: "produccion", label: "Producción", description: "Vuelco, corridas y pallets" },
  { value: "frio", label: "Frío", description: "Túneles y cámaras" },
  { value: "despacho", label: "Despacho", description: "Cargas y envíos" },
  { value: "calidad", label: "Calidad", description: "Retenciones y trazabilidad" },
  { value: "user", label: "Consulta", description: "Solo dashboard y trazabilidad" },
];

// null = acceso para todos los usuarios autenticados
export const PAGE_ACCESS = {
  "/": null,
  "/recepcion": ["admin", "supervisor", "recepcion", "calidad"],
  "/vuelco": ["admin", "supervisor", "produccion"],
  "/produccion": ["admin", "supervisor", "produccion"],
  "/prefrio": ["admin", "supervisor", "frio"],
  "/camaras": ["admin", "supervisor", "frio"],
  "/despachos": ["admin", "supervisor", "despacho"],
  "/trazabilidad": null,
  "/catalogos": ["admin", "supervisor"],
  "/usuarios": ["admin"],
};

export const roleLabel = (role) => {
  if (!role) return "—";
  const found = ROLES.find((r) => r.value === role);
  return found ? found.label : role;
};

export const canAccess = (role, path) => {
  const allowed = PAGE_ACCESS[path];
  if (!allowed) return true;
  return allowed.includes(role);
};