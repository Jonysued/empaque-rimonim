export const STATIONS = {
  cosecha: { label: 'Cosecha', path: '/recepcion', entities: ['Bin','Catalog'] },
  consolidado: { label: 'Consolidado de Lote', path: '/consolidado-lote', entities: ['ReceiptLot','Bin','Catalog'] },
  pesado: { label: 'Pesado de Lote', path: '/pesado-lote', entities: ['ReceiptLot','Bin'] },
  playa: { label: 'Recepción Playa Empaque', path: '/recepcion-playa', entities: ['ReceiptLot','Bin'] },
  vuelco: { label: 'Vuelco', path: '/vuelco', entities: ['ReceiptLot','Bin','DumpingEvent'] },
  produccion: { label: 'Producción', path: '/produccion', entities: ['Pallet','Catalog'] },
  prefrio: { label: 'Prefrío', path: '/prefrio', entities: ['Pallet','Location','CoolingCycle','StorageBatch'] },
  camaras: { label: 'Cámaras', path: '/camaras', entities: ['Pallet','Location','CoolingCycle','StorageBatch'] },
  despacho: { label: 'Despachos', path: '/despachos', entities: ['Pallet','Shipment','Catalog'] },
  insumos: { label: 'Stock Insumos', path: '/stock-insumos', entities: [] },
};
export const isStationRole = role => Object.hasOwn(STATIONS, role || '');
export const canCorrect = role => ['admin','supervisor'].includes(role);
export const isReadOnly = role => role === 'consulta';
export const homePath = role => STATIONS[role]?.path || '/';
export const ALL_ENTITIES = ['ReceiptLot','DumpingEvent','Pallet','Location','CoolingCycle','StorageBatch','Shipment','Catalog','Bin','ProductionRun','MovementEvent'];
export const offlineEntities = role => STATIONS[role]?.entities || (['admin','supervisor','consulta'].includes(role) ? ALL_ENTITIES : []);
export const canReadEntity = (role, entity) => offlineEntities(role).includes(entity) || entity === 'User' && role === 'admin';
export const canReadStock = role => ['admin','supervisor','consulta','insumos'].includes(role);
export const ROLES = [
  { value:'admin', label:'Administrador', description:'Acceso total y correcciones' },
  { value:'supervisor', label:'Supervisor', description:'Acceso operativo total y correcciones' },
  ...Object.entries(STATIONS).map(([value,s]) => ({value,label:s.label,description:'Solo su estación · registrar operaciones, sin corregir ni eliminar'})),
  { value:'consulta', label:'Solo lectura', description:'Consultar e imprimir; sin modificar datos' },
  { value:'user', label:'Sin acceso', description:'Pendiente de autorización' },
];
export const PAGE_ACCESS = {
  '/':['admin','supervisor','consulta'],
  ...Object.fromEntries(Object.values(STATIONS).map(s=>[s.path,['admin','supervisor','consulta']])),
  '/trazabilidad':['admin','supervisor','consulta'],
  '/catalogos':['admin','supervisor','consulta'],
  '/usuarios':['admin'],
  '/empresas':['admin'],
};
export const canAccess = (role,path) => isStationRole(role) ? STATIONS[role].path === path : Boolean(PAGE_ACCESS[path]?.includes(role));
export const roleLabel = role => ROLES.find(r=>r.value===role)?.label || (['recepcion','frio','calidad'].includes(role) ? 'Perfil anterior · asignar estación' : role || '—');

// The server independently enforces this allowlist.
export function canSubmitCommand(role,rpc,p={}) {
  if (canCorrect(role)) return true;
  if (!isStationRole(role)) return false;
  if (rpc==='harvest_bin_operation') return role==='cosecha';
  if (rpc==='field_lot_operation') return role==='consolidado' && ['create','add_bin','close'].includes(p.p_action)
    || role==='pesado' && p.p_action==='weigh' || role==='playa' && p.p_action==='receive';
  if (['dump_bin_by_qr','dump_lot_by_bins'].includes(rpc)) return role==='vuelco';
  if (rpc==='offline_record_operation') return role==='produccion' && p.p_entity==='Pallet' && p.p_action==='create'
    || role==='despacho' && p.p_entity==='Shipment' && ['create','dispatch'].includes(p.p_action);
  if (rpc==='load_pallet_into_shipment') return role==='despacho';
  if (rpc==='cooling_cycle_command') return role==='prefrio' && ['iniciar','finalizar'].includes(p.p_action);
  if (rpc==='cold_storage_command') return ['prefrio','camaras'].includes(role) && ['ingresar','retirar','iniciar_carga','completar_carga','habilitar_quinta'].includes(p.p_action);
  if (rpc==='supply_command') return role==='insumos' && p.p_action==='movement' && ['ingreso','devolucion','rotura','traslado'].includes(p.p_payload?.kind);
  return false;
}
