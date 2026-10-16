import AdminHarvestActions from '@/components/AdminHarvestActions';
import { useAuth } from '@/lib/AuthContext';
import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { generateCode, fmtDate, fmtKg } from '@/lib/qr';
import { isFieldLot } from '@/lib/fieldWorkflow.mjs';
import { useFieldLots, fieldOperation } from '@/lib/fieldLots';
import LotDetail, { PendingLotNotice } from '@/components/LotDetail';
import StatusBadge from '@/components/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Layers, Plus } from 'lucide-react';
import { toast } from 'sonner';
export default function ConsolidadoLote() {
  const { user } = useAuth();
  const { lots, bins, loading, error, refresh } = useFieldLots();
  const [showForm,setShowForm] = useState(false);
  const [selectedId,setSelectedId] = useState(null);
  const selected = lots.find(lot=>lot.id === selectedId);
  const available = bins.filter(bin => Number(bin.harvest_workflow) === 3 && !bin.receipt_lot_id && bin.pendingStatus !== 'conflict');
  return <div className="min-w-0 space-y-6">
    <div className="flex items-center justify-between flex-wrap gap-3"><div><h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Layers className="w-6 h-6" /> Consolidado de Lote</h1>
      <p className="text-muted-foreground">Agrupar los bines registrados en Cosecha y cargar el transporte del lote</p></div>
      <Button size="lg" onClick={()=>setShowForm(true)}><Plus className="w-5 h-5 mr-1" /> Nuevo consolidado</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-sm text-muted-foreground">{available.length} BINs de cosecha disponibles para consolidar.</p>
    {loading ? <p>Cargando…</p> : !lots.length ? <Card><CardContent className="py-12 text-center">No hay lotes registrados.</CardContent></Card> :
      <div className="min-w-0 space-y-3">
        <p className="text-xs text-muted-foreground sm:hidden">Deslizá la tabla hacia los costados para ver todas las columnas.</p>
        <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
          <Table aria-label="Consolidados de lote">
            <TableHeader><TableRow>
              <TableHead scope="col">Lote</TableHead><TableHead scope="col">Estado</TableHead>
              <TableHead scope="col">Transporte</TableHead><TableHead scope="col">Productor</TableHead>
              <TableHead scope="col">Variedad</TableHead><TableHead scope="col" className="text-right">BINs</TableHead>
              <TableHead scope="col">Fecha de registro</TableHead><TableHead scope="col" className="text-right">Neto</TableHead>
              <TableHead scope="col" className="text-right">Sin volcar</TableHead><TableHead scope="col" className="text-right">Volcado</TableHead>
            {user?.role === 'admin' && <TableHead scope="col" className="text-right">Administración</TableHead>}</TableRow></TableHeader>
            <TableBody>{lots.map(lot => <TableRow key={lot.id}>
              <TableCell><button type="button" className="min-h-11 text-left font-mono font-semibold text-primary underline underline-offset-4 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Ver consolidado ${lot.lot_code}`} onClick={()=>setSelectedId(lot.id)}>{lot.lot_code}</button>{!isFieldLot(lot) && <p className="text-xs text-muted-foreground">Lote del flujo anterior</p>}</TableCell>
              <TableCell><div className="flex items-center gap-2"><StatusBadge status={lot.status} label={Number(lot.workflow_version) === 3 && lot.status === 'en_campo' ? 'En consolidado' : undefined} />{lot.held && <StatusBadge status="retenido" />}</div><PendingLotNotice lot={lot} /></TableCell>
              <TableCell>{lot.transport || '—'}</TableCell><TableCell>{lot.producer || '—'}</TableCell>
              <TableCell>{lot.variety || '—'}</TableCell><TableCell className="text-right">{lot.bins_count || 0}{Number(lot.workflow_version) === 2 && lot.status === 'en_campo' ? ` / ${lot.expected_bins_count} declarados` : ''}</TableCell>
              <TableCell>{fmtDate(lot.field_created_at || lot.receipt_date)}</TableCell>
              <TableCell className="text-right">{lot.net_weight != null ? fmtKg(lot.net_weight) : 'Pendiente de pesado'}</TableCell>
              <TableCell className="text-right">{lot.net_weight != null ? fmtKg(lot.remaining_weight) : '—'}</TableCell>
              <TableCell className="text-right">{lot.net_weight != null ? fmtKg(lot.dumped_weight) : '—'}</TableCell>
            {user?.role === 'admin' && <TableCell className="text-right"><AdminHarvestActions entity="ReceiptLot" record={lot} onSaved={refresh} /></TableCell>}</TableRow>)}</TableBody>
          </Table>
        </div>
      </div>}
    {showForm && <ConsolidationForm onClose={()=>setShowForm(false)} onSaved={async (id,pending)=>{
      setShowForm(false);setSelectedId(id);if(pending)toast.warning('Consolidado guardado en este dispositivo; pendiente de sincronizar');await refresh();
    }} />}
    {selected && <LotDetail lot={selected} bins={bins.filter(bin=>bin.receipt_lot_id === selected.id)} availableBins={available} onClose={()=>setSelectedId(null)} onUpdated={refresh} />}
  </div>;
}
function ConsolidationForm({onClose,onSaved}) {
  const [transport,setTransport]=useState('');
  const [carriers,setCarriers]=useState([]);
  const [loadingCarriers,setLoadingCarriers]=useState(true);
  const [catalogError,setCatalogError]=useState('');
  const [id]=useState(()=>crypto.randomUUID());
  const [operationId]=useState(()=>crypto.randomUUID());
  const [code]=useState(()=>generateCode('LOT'));
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  useEffect(() => {
    let active = true;
    base44.entities.Catalog.filter({type:'transportista'}).then(items => {
      if (active) setCarriers(items.filter(item => item.active !== false).sort((a,b) => a.label.localeCompare(b.label)));
    }).catch(e => { if (active) setCatalogError(e.message || 'No se pudieron cargar los transportistas'); })
      .finally(() => { if (active) setLoadingCarriers(false); });
    return () => { active = false; };
  }, []);
  async function save(event){event.preventDefault();setError('');const carrier=carriers.find(item=>item.id===transport);if(loadingCarriers || catalogError || !carrier)return setError('Seleccioná un transportista de Catálogos');setSaving(true);
    try{const result=await fieldOperation(id,'create',{p_record:{workflow_version:3,lot_code:code,transport:carrier.label}},operationId);await onSaved(id,result.pending);}
    catch(e){setError(e.message);setSaving(false);}}
  return <Dialog open onOpenChange={()=>{if(!saving)onClose();}}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Nuevo consolidado de lote</DialogTitle></DialogHeader>
    <form onSubmit={save} className="space-y-4"><div className="space-y-1"><Label htmlFor="consolidation-transport">Transportista *</Label><select id="consolidation-transport" className="flex h-11 w-full rounded-md border bg-background px-3 text-sm" required disabled={saving || loadingCarriers || !!catalogError || !carriers.length} value={transport} onChange={e=>setTransport(e.target.value)}><option value="">{loadingCarriers ? 'Cargando transportistas…' : 'Seleccionar transportista'}</option>{carriers.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
      {catalogError && <p role="alert" className="text-sm text-destructive">{catalogError}</p>}
      {!loadingCarriers && !catalogError && !carriers.length && <p className="text-sm text-muted-foreground">Primero agregá un transportista en Catálogos → Transportistas.</p>}
      <p className="text-sm text-muted-foreground">Después escaneá los QR de los bines cosechados que integran este lote y presioná «Cerrar lote».</p>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex flex-col sm:flex-row gap-2 justify-end"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving || loadingCarriers || !!catalogError || !transport}>{saving?'Guardando…':'Crear lote y escanear bines'}</Button></div>
    </form></DialogContent></Dialog>;
}
