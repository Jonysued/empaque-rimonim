import { createClient } from '@supabase/supabase-js';
export default async function handler(req,res) {
  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});
  const url=process.env.VITE_SUPABASE_URL;
  const anon=process.env.VITE_SUPABASE_ANON_KEY;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!anon||!secret||!process.env.APP_URL) return res.status(503).json({error:'Falta configurar Supabase'});
  const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];
  if(!token) return res.status(401).json({error:'No autorizado'});
  const scoped=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:{user},error:authError}=await scoped.auth.getUser(token);
  if(authError||!user) return res.status(401).json({error:'Sesión inválida'});
  const {data:profile,error:profileError}=await scoped.from('profiles').select('role').eq('id',user.id).single();
  if(profileError||profile?.role!=='admin') return res.status(403).json({error:'Solo administradores'});
  const email=String(req.body?.email||'').trim().toLowerCase();
  const role=String(req.body?.role||'user');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!['admin','supervisor','recepcion','produccion','frio','despacho','calidad','user'].includes(role)) return res.status(400).json({error:'Email o rol inválido'});
  const admin=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data,error}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:process.env.APP_URL});
  if(error) return res.status(400).json({error:error.message});
  const {error:updateError}=await admin.from('profiles').update({role}).eq('id',data.user.id);
  if(updateError) return res.status(500).json({error:'Usuario invitado; asignación de rol pendiente'});
  return res.status(200).json({id:data.user.id,email,role});
}
