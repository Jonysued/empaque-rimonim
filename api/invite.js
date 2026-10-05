import { createClient } from '@supabase/supabase-js';
export default async function handler(req,res) {
  if(['https://localhost','capacitor://localhost'].includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
    res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
    res.setHeader('Vary','Origin');
  }
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='POST') return res.status(405).json({error:'Método no permitido'});
  const url=process.env.VITE_SUPABASE_URL;
  const anon=process.env.VITE_SUPABASE_ANON_KEY;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!anon||!secret||!process.env.APP_URL) return res.status(503).json({error:'Falta configurar Supabase'});
  const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];
  if(!token) return res.status(401).json({error:'No autorizado'});
  const companyId=req.body?.company_id;
  if(companyId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) return res.status(400).json({error:'Empresa inválida'});
  const scoped=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`,...(companyId?{'x-empaco-company':companyId}:{})}}});
  const {data:{user},error:authError}=await scoped.auth.getUser(token);
  if(authError||!user) return res.status(401).json({error:'Sesión inválida'});
  const {data:roleInCompany,error:roleError}=await scoped.rpc('my_role');
  if(roleError||roleInCompany!=='admin') return res.status(403).json({error:'Solo administradores de esta empresa'});
  let companyQuery=scoped.from('companies').select('id,slug').eq('active',true);
  companyQuery=companyId?companyQuery.eq('id',companyId):companyQuery.eq('slug','rimonim');
  const {data:company,error:companyError}=await companyQuery.single();
  if(companyError||!company) return res.status(403).json({error:'Empresa no autorizada'});
  const email=String(req.body?.email||'').trim().toLowerCase();
  const role=String(req.body?.role||'user');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!['admin','supervisor','recepcion','produccion','frio','despacho','calidad','user'].includes(role)) return res.status(400).json({error:'Email o rol inválido'});
  const admin=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:existing,error:lookupError}=await admin.from('profiles').select('id').eq('email',email).maybeSingle();
  if(lookupError) return res.status(503).json({error:'No se pudo consultar el usuario'});
  let invitedId=existing?.id;
  if(!invitedId) {
    const {data,error}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:process.env.APP_URL});
    if(error) return res.status(400).json({error:'No se pudo enviar la invitación'});
    invitedId=data.user.id;
  }
  const {error:membershipError}=await admin.from('company_memberships').insert({company_id:company.id,user_id:invitedId,role});
  if(membershipError?.code==='23505') return res.status(409).json({error:'El usuario ya pertenece a esta empresa. Editá su rol desde Usuarios.'});
  if(membershipError) return res.status(500).json({error:'No se pudo asignar el usuario a la empresa. Volvé a intentar.'});
  if(company.slug==='rimonim') {
    const {error:updateError}=await admin.from('profiles').update({role}).eq('id',invitedId);
    if(updateError) return res.status(500).json({error:'Usuario asignado; compatibilidad del rol pendiente'});
  }
  return res.status(200).json({id:invitedId,email,role,existing:Boolean(existing)});
}
