import React, { useState } from 'react';
import { supabase, base44, localSessionIdentity } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { getOperations } from '@/lib/operationQueue';
import { workspaceOwner } from '@/lib/workspace';
import { readSnapshot, saveSnapshot } from '@/lib/offlineStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Pencil } from 'lucide-react';

const binFields = [['producer','Productor'],['variety','Variedad'],['origin','Cuadro'],['species','Especie'],['harvest_type','Tipo de cosecha'],['crew','Cuadrilla'],['harvest_date','Fecha de cosecha'],['quality_notes','Notas de calidad']];
export default function AdminHarvestActions({ record, entity, onSaved }) {
  const { user } = useAuth();
  const [open,setOpen]=useState(false);
  const [original,setOriginal]=useState(null);
  const [form,setForm]=useState(/** @type {Record<string, any>} */ ({}));
  const [carriers,setCarriers]=useState([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [mode,setMode]=useState('edit');
  const [attempt,setAttempt]=useState(null);
  const [confirmAction,setConfirmAction]=useState(null);
  if(user?.role!=='admin')return null;
  async function show() {
    setOpen(true);setBusy(true);setError('');setOriginal(null);setMode('edit');setAttempt(null);setConfirmAction(null);
    try {
      if(!navigator.onLine)throw new Error('Conectate para realizar correcciones administrativas.');
      if((await getOperations()).length)throw new Error('Sincronizá las operaciones pendientes antes de editar o eliminar.');
      const {data,error:readError}=await supabase.from('records').select('data').eq('entity',entity).eq('id',record.id).single();
      if(readError)throw readError;
      if(entity==='ReceiptLot')setCarriers((await base44.entities.Catalog.filter({type:'transportista'})).filter(item=>item.active!==false));
      setOriginal(data.data);setForm({...data.data});
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function save(action) {
    setBusy(true);setError('');
    try {
      if(!navigator.onLine)throw new Error('Se necesita conexión para confirmar la corrección.');
      if((await getOperations()).length)throw new Error('Sincronizá las operaciones pendientes antes de continuar.');
      const patch=action==='edit_weight'?{gross_weight:Number(form.gross_weight),tare_weight:Number(form.tare_weight)}:
        action==='edit'?Object.fromEntries((entity==='Bin'?binFields.map(([key])=>key):['transport','quality_notes']).filter(key=>(form[key]||'')!==(original[key]||'')).map(key=>[key,form[key]||''])):{};
      const params={p_entity:entity,p_id:record.id,p_action:action,p_expected:original,p_patch:patch};
      const signature=JSON.stringify(params);
      const operationId=attempt?.signature===signature?attempt.id:crypto.randomUUID();
      setAttempt({signature,id:operationId});
      const {data,error:rpcError}=await supabase.rpc('admin_harvest_correction',{...params,p_operation_id:operationId});
      if(rpcError)throw rpcError;
      const identity=await localSessionIdentity();const owner=workspaceOwner(identity.id);
      for(const name of ['Bin','ReceiptLot']) {
        const cached=await readSnapshot(owner,name);
        if(!cached)continue;
        const removed=new Set((data.deleted||[]).filter(item=>item.entity===name).map(item=>item.id));
        const changed=new Map((data.records||[]).filter(item=>item.entity===name).map(item=>[item.id,item]));
        const next=cached.filter(item=>!removed.has(item.id)).map(item=>{const updated=changed.get(item.id);changed.delete(item.id);return updated||item;});
        await saveSnapshot(owner,name,[...next,...changed.values()]);
      }
      await onSaved();setOpen(false);
    }catch(e){setError(e.message || 'No se pudo confirmar la corrección. Podés reintentar.');}finally{setBusy(false);}
  }
  return <>
    <Button type="button" variant="outline" className="min-h-11" onClick={show} disabled={!!record.pendingStatus}><Pencil className="mr-1 h-4 w-4" />Editar</Button>
    {open&&<Dialog open onOpenChange={()=>{if(!busy)setOpen(false);}}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Editar {entity==='Bin'?'BIN':'lote'} {record.bin_code||record.lot_code}</DialogTitle></DialogHeader>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      {busy&&!original&&<p>Cargando registro…</p>}
      {original&&<>
        <p className="text-sm text-muted-foreground">La corrección queda registrada. No se permiten cambios que alteren vuelcos realizados.</p>
        {entity==='ReceiptLot'&&original.weighed_at&&<div className="flex flex-wrap gap-2"><Button variant={mode==='edit'?'default':'outline'} disabled={busy} onClick={()=>{setMode('edit');setConfirmAction(null);}}>Datos del lote</Button><Button variant={mode==='edit_weight'?'default':'outline'} disabled={busy} onClick={()=>{setMode('edit_weight');setConfirmAction(null);}}>Pesaje</Button></div>}
        <form className="space-y-4" onSubmit={e=>{e.preventDefault();save(mode);}}>
          {mode==='edit_weight'?<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[['gross_weight','Peso bruto (kg)'],['tare_weight','Tara (kg)']].map(([key,label])=><label key={key} className="space-y-1 block"><span className="text-sm font-medium">{label}</span><Input type="number" required min={key==='gross_weight'?'0.1':'0'} step="0.1" disabled={busy} value={form[key]??''} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}</div>:
            entity==='Bin'?<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{binFields.map(([key,label])=><label key={key} className="space-y-1 block"><span className="text-sm font-medium">{label}</span><Input type={key==='harvest_date'?'date':'text'} required={['producer','variety','harvest_date'].includes(key)} disabled={busy} value={form[key]||''} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}</div>:
            <><label className="block space-y-1"><span className="text-sm font-medium">Transportista</span><select className="h-11 w-full rounded-md border bg-background px-3" required disabled={busy} value={form.transport||''} onChange={e=>setForm({...form,transport:e.target.value})}><option value="">Seleccionar</option>{original.transport&&!carriers.some(c=>c.label===original.transport)&&<option value={original.transport}>{original.transport} (actual)</option>}{carriers.map(c=><option key={c.id} value={c.label}>{c.label}</option>)}</select></label><label className="block space-y-1"><span className="text-sm font-medium">Notas de calidad</span><Input disabled={busy} value={form.quality_notes||''} onChange={e=>setForm({...form,quality_notes:e.target.value})}/></label></>}
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>setOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy?'Guardando…':'Guardar cambios'}</Button></div>
        </form>
        <div className="border-t pt-4 space-y-3">
          <Button type="button" variant="destructive" disabled={busy} onClick={()=>setConfirmAction(mode==='edit_weight'?'delete_weight':'delete')}>{mode==='edit_weight'?'Eliminar pesaje':entity==='Bin'?'Eliminar BIN':'Eliminar lote'}</Button>
          {confirmAction&&<div role="alert" className="space-y-2 text-sm"><p>{confirmAction==='delete_weight'?'Se quitarán bruto, tara y neto; el lote volverá a pendientes de pesado.':entity==='Bin'?'Se eliminará este BIN. Solo se permite si está libre o en un consolidado abierto.':'Se eliminará el lote y sus bines quedarán disponibles para consolidar. Primero debe eliminarse el pesaje, si existe.'}</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={()=>setConfirmAction(null)}>Volver</Button><Button variant="destructive" disabled={busy} onClick={()=>save(confirmAction)}>Confirmar eliminación</Button></div></div>}
        </div>
      </>}
    </DialogContent></Dialog>}
  </>;
}
