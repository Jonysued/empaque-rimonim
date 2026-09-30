import React, { useState } from 'react';
import { generateCode } from '@/lib/qr';
import { useFieldLots, fieldOperation } from '@/lib/fieldLots';
import LotDetail, { LotSummary } from '@/components/LotDetail';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Layers, Plus } from 'lucide-react';
import { toast } from 'sonner';
export default function ConsolidadoLote() {
  const { lots, bins, loading, error, refresh } = useFieldLots();
  const [showForm,setShowForm] = useState(false);
  const [selectedId,setSelectedId] = useState(null);
  const selected = lots.find(lot=>lot.id === selectedId);
  const available = bins.filter(bin => Number(bin.harvest_workflow) === 3 && !bin.receipt_lot_id && bin.pendingStatus !== 'conflict');
  return <div className="space-y-6">
    <div className="flex items-center justify-between flex-wrap gap-3"><div><h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Layers className="w-6 h-6" /> Consolidado de Lote</h1>
      <p className="text-muted-foreground">Agrupar los bines registrados en Cosecha y cargar el transporte del lote</p></div>
      <Button size="lg" onClick={()=>setShowForm(true)}><Plus className="w-5 h-5 mr-1" /> Nuevo consolidado</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-sm text-muted-foreground">{available.length} BINs de cosecha disponibles para consolidar.</p>
    {loading ? <p>Cargando…</p> : !lots.length ? <Card><CardContent className="py-12 text-center">No hay lotes registrados.</CardContent></Card> :
      <div className="space-y-3">{lots.map(lot=><button key={lot.id} type="button" className="block w-full text-left" onClick={()=>setSelectedId(lot.id)}><LotSummary lot={lot} /></button>)}</div>}
    {showForm && <ConsolidationForm onClose={()=>setShowForm(false)} onSaved={async (id,pending)=>{
      setShowForm(false);setSelectedId(id);if(pending)toast.warning('Consolidado guardado en este dispositivo; pendiente de sincronizar');await refresh();
    }} />}
    {selected && <LotDetail lot={selected} bins={bins.filter(bin=>bin.receipt_lot_id === selected.id)} availableBins={available} onClose={()=>setSelectedId(null)} onUpdated={refresh} />}
  </div>;
}
function ConsolidationForm({onClose,onSaved}) {
  const [transport,setTransport]=useState('');
  const [id]=useState(()=>crypto.randomUUID());
  const [operationId]=useState(()=>crypto.randomUUID());
  const [code]=useState(()=>generateCode('LOT'));
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  async function save(event){event.preventDefault();if(!transport.trim())return setError('Ingresá el nombre del transporte');setSaving(true);
    try{const result=await fieldOperation(id,'create',{p_record:{workflow_version:3,lot_code:code,transport:transport.trim()}},operationId);await onSaved(id,result.pending);}
    catch(e){setError(e.message);setSaving(false);}}
  return <Dialog open onOpenChange={()=>{if(!saving)onClose();}}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Nuevo consolidado de lote</DialogTitle></DialogHeader>
    <form onSubmit={save} className="space-y-4"><div className="space-y-1"><Label htmlFor="consolidation-transport">Nombre del transporte *</Label><Input id="consolidation-transport" required disabled={saving} value={transport} onChange={e=>setTransport(e.target.value)} /></div>
      <p className="text-sm text-muted-foreground">Después escaneá los QR de los bines cosechados que integran este lote y presioná «Cerrar lote».</p>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex gap-2 justify-end"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving?'Guardando…':'Crear lote y escanear bines'}</Button></div>
    </form></DialogContent></Dialog>;
}
