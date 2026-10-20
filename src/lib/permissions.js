export const ROLES = [
  { value: "admin", label: "Administrador", description: "Acceso total" },
  { value: "supervisor", label: "Supervisor", description: "Acceso operativo total" },
  { value: "recepcion", label: "Recepción", description: "Cosecha, consolidado, pesado y playa" },
  { value: "produccion", label: "Producción", description: "Vuelco, corridas y pallets" },
  { value: "frio", label: "Frío", description: "Túneles y cámaras" },
  { value: "despacho", label: "Despacho", description: "Cargas y envíos" },
  { value: "calidad", label: "Calidad", description: "Retenciones y trazabilidad" },
  { value: "consulta", label: "Solo lectura", description: "Consultar e imprimir; sin modificar datos" },
  { value: "user", label: "Sin acceso", description: "Pendiente de autorización" },
];

// null = acceso para todos los usuarios autenticados
export const PAGE_ACCESS = {
  "/": null,
  "/recepcion": ["admin", "supervisor", "recepcion", "calidad"],
  "/consolidado-lote": ["admin", "supervisor", "recepcion", "calidad"],
  "/pesado-lote": ["admin", "supervisor", "recepcion", "calidad"],
  "/recepcion-playa": ["admin", "supervisor", "recepcion", "calidad"],
  "/vuelco": ["admin", "supervisor", "produccion"],
  "/produccion": ["admin", "supervisor", "produccion"],
  "/prefrio": ["admin", "supervisor", "frio"],
  "/camaras": ["admin", "supervisor", "frio"],
  "/despachos": ["admin", "supervisor", "despacho"],
  "/trazabilidad": null,
  "/stock-insumos": ["admin", "supervisor", "recepcion", "produccion", "frio", "despacho", "calidad"],
  "/catalogos": ["admin", "supervisor"],
  "/usuarios": ["admin"],
};

export const roleLabel = (role) => {
  if (!role) return "—";
  const found = ROLES.find((r) => r.value === role);
  return found ? found.label : role;
};

export const canAccess = (role, path) => {
  if (role === 'consulta') return Object.hasOwn(PAGE_ACCESS, path) && path !== '/usuarios';
  const allowed = PAGE_ACCESS[path];
  if (!allowed) return true;
  return allowed.includes(role);
};

export const isReadOnly = role => role === 'consulta';
