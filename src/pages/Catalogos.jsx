import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Settings, Plus, Trash2, Edit2 } from "lucide-react";
import LocationConfig from "@/components/LocationConfig";

const CATALOG_TYPES = [
  { value: "productor", label: "Productores/Propietarios" },
  { value: "finca", label: "Fincas" },
  { value: "cuadro", label: "Procedencias/Cuadros" },
  { value: "variedad", label: "Variedades" },
  { value: "especie", label: "Especies" },
  { value: "tipo_cosecha", label: "Tipos de cosecha" },
  { value: "cuadrilla", label: "Cuadrillas" },
  { value: "tipo_proceso", label: "Tipos de proceso" },
  { value: "destino", label: "Destinos" },
  { value: "categoria", label: "Categorías" },
  { value: "calibre", label: "Calibres" },
  { value: "envase", label: "Envases/Cajas" },
  { value: "tipo_pallet", label: "Tipos de pallet" },
  { value: "tara", label: "Taras" },
  { value: "linea", label: "Líneas" },
  { value: "turno", label: "Turnos" },
  { value: "causa_descarte", label: "Causas de descarte" },
  { value: "causa_retencion", label: "Causas de retención" },
  { value: "cliente", label: "Clientes" },
];

const CONFIG_TABS = [
  ...CATALOG_TYPES,
  { value: "loc_tunel", label: "Túneles de prefrío" },
  { value: "loc_camara", label: "Cámaras de frío" },
];

export default function Catalogos() {
  const [activeType, setActiveType] = useState("productor");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  async function refresh() {
    if (activeType.startsWith("loc_")) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await base44.entities.Catalog.filter({ type: activeType });
      setItems((data || []).sort((a, b) => (a.label || "").localeCompare(b.label || "")));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, [activeType]);

  async function handleDelete(id) {
    if (!confirm("¿Eliminar este valor del catálogo?")) return;
    try {
      await base44.entities.Catalog.delete(id);
      refresh();
    } catch (e) { console.error(e); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Settings className="w-6 h-6" /> Catálogos</h1>
        <p className="text-muted-foreground">Configuración de valores operativos</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {CONFIG_TABS.map(t => (
          <button
            key={t.value}
            onClick={() => setActiveType(t.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeType === t.value ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeType.startsWith("loc_") ? (
        <LocationConfig type={activeType === "loc_tunel" ? "tunel" : "camara"} />
      ) : (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{CONFIG_TABS.find(t => t.value === activeType)?.label}</CardTitle>
          <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="w-4 h-4 mr-1" /> Agregar</Button>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Cargando…</p> :
            items.length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">Sin valores. Agregue el primero.</p> : (
              <div className="space-y-1">
                {items.map(item => (
                  <div key={item.id} className="flex items-center justify-between border rounded-lg p-2">
                    <div>
                      <p className="font-medium text-sm">{item.label}</p>
                      {item.value && item.value !== item.label && <p className="text-xs text-muted-foreground font-mono">{item.value}</p>}
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(item); setShowForm(true); }}><Edit2 className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(item.id)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </CardContent>
      </Card>
      )}

      {showForm && <CatalogForm type={activeType} item={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refresh(); }} />}
    </div>
  );
}

function CatalogForm({ type, item, onClose, onSaved }) {
  const [label, setLabel] = useState(item?.label || "");
  const [value, setValue] = useState(item?.value || "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!label) return;
    setSaving(true);
    try {
      const payload = { type, label, value: value || label, active: true };
      if (item) {
        await base44.entities.Catalog.update(item.id, payload);
      } else {
        await base44.entities.Catalog.create(payload);
      }
      onSaved();
    } catch (e) { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{item ? "Editar" : "Agregar"} valor</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1"><Label className="text-xs">Etiqueta *</Label><Input value={label} onChange={e => setLabel(e.target.value)} autoFocus /></div>
          <div className="space-y-1"><Label className="text-xs">Valor interno (opcional)</Label><Input value={value} onChange={e => setValue(e.target.value)} placeholder="= etiqueta si vacío" /></div>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}