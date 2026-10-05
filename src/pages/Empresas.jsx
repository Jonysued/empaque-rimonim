import React, { useEffect, useState } from 'react';
import { base44, supabase } from '@/api/base44Client';
import { selectWorkspace } from '@/lib/workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { roleLabel } from '@/lib/permissions';

export default function Empresas() {
  const [user,setUser]=useState(null), [name,setName]=useState(''), [slug,setSlug]=useState('');
  const [error,setError]=useState(''), [busy,setBusy]=useState(false);
  useEffect(()=> { base44.auth.me().then(setUser).catch(e=>setError(e.message)); },[]);
  const choose = id => {
    if(!navigator.onLine) { setError('Conectate para cambiar de empresa. Las operaciones pendientes quedan en su empresa de origen.'); return; }
    selectWorkspace(user.id,id);
  };
  const create = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const {data,error:failure}=await supabase.rpc('create_company',{p_name:name,p_slug:slug});
      if(failure) throw failure;
      choose(data.id);
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">Espacio de trabajo</h1><p className="text-sm text-muted-foreground">Cada empresa tiene sus registros, catálogos, ubicaciones y equipo.</p></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!user && !error && <p>Cargando empresas...</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      {user?.memberships.map(m=> <Card key={m.company_id}><CardHeader><CardTitle className="break-words">{m.companies.name}</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm">{roleLabel(m.role)}</p><Button disabled={m.company_id===user.workspace?.id} onClick={()=>choose(m.company_id)}>{m.company_id===user.workspace?.id?'Empresa actual':'Entrar'}</Button></CardContent></Card>)}
    </div>
    {user && !user.memberships.length && <p>Tu cuenta todavía no tiene una empresa asignada.</p>}
    {user?.platformAdmin && <Card><CardHeader><CardTitle>Crear empresa</CardTitle></CardHeader><CardContent>
      <form onSubmit={create} className="space-y-4 max-w-lg">
        <p className="text-sm text-muted-foreground">El espacio comienza vacío. Tendrás acceso como administrador para configurarlo e invitar al equipo del cliente.</p>
        <div><Label htmlFor="company-name">Nombre de la empresa</Label><Input id="company-name" required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)} /></div>
        <div><Label htmlFor="company-slug">Identificador</Label><Input id="company-slug" required pattern="[a-z0-9][a-z0-9-]{1,79}" maxLength={80} placeholder="empaque-del-sur" value={slug} onChange={e=>setSlug(e.target.value.toLowerCase())} /><p className="text-xs text-muted-foreground">Letras minúsculas, números y guiones. Debe ser único.</p></div>
        <Button disabled={busy || !navigator.onLine} type="submit">{busy?'Creando...':'Crear espacio de trabajo'}</Button>
      </form>
    </CardContent></Card>}
  </div>;
}
