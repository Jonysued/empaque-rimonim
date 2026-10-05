import { createClient } from '@supabase/supabase-js';
import { gunzipSync } from 'node:zlib';

const OWNER = 'jonatan@rimonim.com.ar';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Vary', 'Authorization');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido.' });
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token) return res.status(401).json({ error: 'Iniciá sesión para ver la web privada.' });
  const url = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !secret) return res.status(503).json({ error: 'Acceso temporalmente no disponible.' });
  try {
    const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await auth.auth.getUser(token);
    if (authError || !user?.email || !user.email_confirmed_at) return res.status(401).json({ error: 'Sesión inválida o email sin verificar.' });
    const email = user.email.toLowerCase();
    const owner = email === OWNER;
    const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    if (!owner) {
      const { data: access, error } = await db.from('private_web_access').select('email').eq('email', email).maybeSingle();
      if (error) throw error;
      if (!access) return res.status(403).json({ error: 'Tu email no tiene autorización para ver esta web.' });
    }
    if (req.method === 'GET' && req.query?.action === 'access') {
      if (!owner) return res.status(403).json({ error: 'Solo Jonatan puede administrar los accesos.' });
      const { data, error } = await db.from('private_web_access').select('email,created_at').order('created_at');
      if (error) throw error;
      return res.status(200).json({ reviewers: data });
    }
    if (req.method === 'POST') {
      if (!owner) return res.status(403).json({ error: 'Solo Jonatan puede administrar los accesos.' });
      const target = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (target.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target) || target === OWNER) return res.status(400).json({ error: 'Ingresá otro email válido.' });
      if (req.body.action === 'revoke') {
        const { error } = await db.from('private_web_access').delete().eq('email', target);
        if (error) throw error;
        return res.status(200).json({ message: 'Acceso eliminado.' });
      }
      if (req.body.action !== 'authorize') return res.status(400).json({ error: 'Acción inválida.' });
      const { error } = await db.from('private_web_access').upsert({ email: target, created_by: user.id }, { onConflict: 'email' });
      if (error) throw error;
      const { data: existing, error: lookupError } = await db.from('profiles').select('id').eq('email', target).maybeSingle();
      if (lookupError) throw lookupError;
      if (!existing) {
        const { error: inviteError } = await db.auth.admin.inviteUserByEmail(target, { redirectTo: `${process.env.APP_URL || 'https://app.empaco.com.ar'}/reset-password` });
        if (inviteError) return res.status(200).json({ message: 'Email autorizado. No se pudo enviar la invitación; volvé a autorizarlo para reintentar.', warning: true });
        return res.status(200).json({ message: 'Email autorizado e invitación enviada. Después de definir su contraseña, podrá entrar en esta web privada.' });
      }
      return res.status(200).json({ message: 'Email autorizado. Puede entrar con su contraseña actual en el enlace de la web privada.' });
    }
    const { data: design, error } = await db.from('private_web_design').select('html_gzip_base64').eq('id', true).single();
    if (error) throw error;
    const html = gunzipSync(Buffer.from(design.html_gzip_base64, 'base64')).toString('utf8');
    return res.status(200).json({ html, owner });
  } catch {
    return res.status(503).json({ error: 'No pudimos cargar la web. Intentá nuevamente.' });
  }
}
