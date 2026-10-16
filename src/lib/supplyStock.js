import { supabase, localSessionIdentity, isOfflineError } from '@/api/base44Client';
import { workspaceOwner, currentWorkspace } from '@/lib/workspace';
import { readSnapshot, saveSnapshot } from '@/lib/offlineStore';

export const SUPPLY_KINDS={ingreso:'Ingreso con remito',inicial:'Stock inicial',devolucion:'Devolución',rotura:'Rotura / merma',ajuste:'Ajuste de inventario',traslado:'Traslado',consumo_automatico:'Consumo automático',reversion_automatica:'Corrección automática',reversion:'Reversión de comprobante'};
export const quantityLabel=value=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:3}).format(Number(value)||0);
export async function getSupplySnapshot(params={}) {
  const identity=await localSessionIdentity(),owner=workspaceOwner(identity.id);
  try {
    if(identity.offline || !navigator.onLine)throw new TypeError('Sin conexión');
    const {data,error}=await supabase.rpc('supply_snapshot',params);
    if(error)throw error;
    if(data.company_id!==currentWorkspace()?.id)throw new Error('La empresa cambió. Volvé a abrir Stock Insumos.');
    const key=JSON.stringify(params);
    await saveSnapshot(owner,`supplies:${key}`,data);
    if(!Object.keys(params).length)await saveSnapshot(owner,'supplies',data);
    return {...data,offline:false};
  }catch(error){
    if(identity.offline || !navigator.onLine || isOfflineError(error)){
      const cached=await readSnapshot(owner,`supplies:${JSON.stringify(params)}`) || (!Object.keys(params).length ? await readSnapshot(owner,'supplies') : null);
      if(cached)return {...cached,offline:true,limitedCache:!!Object.keys(params).length};
      throw new Error('Conectate una vez para guardar el stock de esta empresa en el dispositivo.');
    }
    throw error;
  }
}
export async function supplyCommand(action,payload,operationId) {
  if(!navigator.onLine)throw new Error('Conectate para confirmar movimientos y reglas de stock.');
  const {data,error}=await supabase.rpc('supply_command',{p_operation_id:operationId,p_action:action,p_payload:payload});
  if(error)throw error;
  window.dispatchEvent(new Event('empaco-stock-change'));
  return data;
}
export async function uploadSupplyFiles(files,operationId) {
  if(files.length>3)throw new Error('Podés adjuntar hasta tres archivos.');
  const company=currentWorkspace()?.id;
  if(!company)throw new Error('Seleccioná una empresa');
  const attachments=[];
  for(let index=0;index<files.length;index++){
    const file=files[index];
    if(file.size>10*1024*1024)throw new Error('Cada adjunto debe pesar hasta 10 MB.');
    if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Adjuntá un PDF o una imagen JPG, PNG o WebP.');
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').replace(/\.\.+/g,'_').slice(-100);
    const path=`${company}/${operationId}/${index}-${safeName}`;
    const {error}=await supabase.storage.from('supply-remitos').upload(path,file,{upsert:false,contentType:file.type});
    if(error && !['409','Duplicate','23505'].includes(String(error.statusCode)) && !/already exists/i.test(error.message))throw error;
    attachments.push({path,name:file.name});
  }
  return attachments;
}
export async function openSupplyAttachment(path) {
  const view=window.open('about:blank','_blank');
  if(!view)throw new Error('Permití abrir una nueva pestaña para ver el remito.');
  view.opener=null;
  try {
    const {data,error}=await supabase.storage.from('supply-remitos').createSignedUrl(path,120);
    if(error)throw error;
    view.location.replace(data.signedUrl);
  }catch(error){view.close();throw error;}
}
export function exportSupplyCsv(rows,items,depots,documents) {
  const cell=value=>{let text=String(value??'');if(/^[=+@\-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const lines=[['Fecha','Movimiento','Insumo','Unidad','Depósito','Cantidad','Referencia','Pallet'],...rows.map(row=>[row.created_at,SUPPLY_KINDS[row.kind]||row.kind,items.get(row.item_id)?.name,items.get(row.item_id)?.unit,depots.get(row.depot_id)?.name,row.quantity,documents.get(row.document_id)?.number,row.pallet_code])];
  const blob=new Blob(['\ufeff'+lines.map(line=>line.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Empaco-stock-movimientos-vista.csv';a.click();URL.revokeObjectURL(url);
}

export async function getSupplyDocument(id) {
  const identity=await localSessionIdentity(),owner=workspaceOwner(identity.id),key=`supply-document:${id}`;
  try {
    if(identity.offline || !navigator.onLine)throw new TypeError('Sin conexión');
    const {data,error}=await supabase.rpc('supply_document_detail',{p_document:id});
    if(error)throw error;
    await saveSnapshot(owner,key,data);return data;
  }catch(error){if(identity.offline||!navigator.onLine||isOfflineError(error)){const cached=await readSnapshot(owner,key);if(cached)return cached;throw new Error('Conectate para consultar el detalle completo de este remito.');}throw error;}
}
