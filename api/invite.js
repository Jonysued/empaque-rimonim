import { createClient } from '@supabase/supabase-js';
function mailError(error) {
  console.error('Empaco invitation mail failed', {code:error?.code,status:error?.status});
  if(error?.code==='email_address_not_authorized') return 'El servicio de correo no permite enviar a este destinatario. Hay que configurar un proveedor de correo para Empaco.';
  if(error?.status===429 || /rate_limit|over_email_send_rate_limit/.test(error?.code||'')) return 'Se alcanzó el límite de envío de correos. Esperá unos minutos y volvé a intentar.';
  return 'El servicio de correo no pudo enviar la invitación. Volvé a intentar; si persiste, hay que revisar la configuración de correo.';
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
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
  if(!url||!anon||!secret) return res.status(503).json({error:'Falta configurar Supabase'});
  try {
    const redirectTo=new URL('/reset-password',process.env.APP_URL||'https://app.empaco.com.ar').href;
    const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];
    if(!token) return res.status(401).json({error:'No autorizado'});
    const companyId=req.body?.company_id;
    if(companyId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) return res.status(400).json({error:'Empresa inválida'});
    const scoped=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`,...(companyId?{'x-empaco-company':companyId}:{})}}});
    const {data:{user},error:authError}=await scoped.auth.getUser(token);
    if(authError||!user) return res.status(401).json({error:'Sesión inválida'});
    const {data:roleInCompany,error:roleError}=await scoped.rpc('my_role');
    if(roleError) return res.status(503).json({error:'No se pudieron verificar los permisos de la empresa. Volvé a intentar.'});
    if(roleInCompany!=='admin') return res.status(403).json({error:'Solo administradores de esta empresa'});
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
    let pending=false;
    if(existing) {
      const {data,error}=await admin.auth.admin.getUserById(existing.id);
      if(error||!data.user) return res.status(503).json({error:'No se pudo verificar el estado de la cuenta.'});
      pending=!data.user.email_confirmed_at;
    }
    if(!invitedId) {
      const {data,error}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo});
      if(error) return res.status(error.status===429?429:502).json({error:mailError(error)});
      invitedId=data.user.id;
    }
    const {error:membershipError}=await admin.from('company_memberships').insert({company_id:company.id,user_id:invitedId,role});
    if(membershipError?.code==='23505'&&!pending) return res.status(409).json({error:'El usuario ya pertenece a esta empresa. Editá su rol desde Usuarios.'});
    if(membershipError&&membershipError.code!=='23505') return res.status(500).json({error:'No se pudo asignar el usuario a la empresa. Volvé a intentar.'});
    if(company.slug==='rimonim'&&!membershipError) {
      const {error:updateError}=await admin.from('profiles').update({role}).eq('id',invitedId);
      if(updateError) return res.status(500).json({error:'Usuario asignado; compatibilidad del rol pendiente'});
    }
    if(pending) {
      const {error}=await admin.auth.resetPasswordForEmail(email,{redirectTo});
      if(error) return res.status(error.status===429?429:502).json({error:mailError(error)});
    }
    return res.status(200).json({id:invitedId,email,role,existing:Boolean(existing),email_sent:!existing||pending,message:pending?'Enlace para definir la contraseña enviado.':existing?'Cuenta incorporada a la empresa. Puede entrar con su contraseña actual.':'Invitación enviada. Revisá también la carpeta de spam.'});
  } catch {
    console.error('Empaco invitation failed unexpectedly');
    return res.status(503).json({error:'No se pudo completar la invitación. Volvé a intentar.'});
  }
}
