import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  if (req.headers.origin !== 'https://empaco.com.ar') return res.status(403).json({ error: 'Origen no permitido.' });
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ error: 'Formato no permitido.' });
  if (Number(req.headers['content-length'] || 0) > 10000) return res.status(413).json({ error: 'Solicitud demasiado larga.' });
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Solicitud inválida.' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 10000) return res.status(400).json({ error: 'Solicitud inválida.' });
  const { id, consent } = body;
  if (body.website) return res.status(200).json({ ok: true });
  const fields = { name: 100, company: 150, email: 254, message: 2000 };
  const input = {};
  for (const [key, max] of Object.entries(fields)) {
    if (body[key] != null && typeof body[key] !== 'string') return res.status(400).json({ error: 'Revisá los datos ingresados.' });
    input[key] = (body[key] || '').trim();
    if (input[key].length > max) return res.status(400).json({ error: 'Revisá los datos ingresados.' });
  }
  input.email = input.email.toLowerCase();
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || consent !== true || input.name.length < 2 || input.company.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) return res.status(400).json({ error: 'Completá nombre, empresa, correo y consentimiento.' });
  const url = process.env.VITE_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return res.status(503).json({ error: 'No pudimos registrar tu solicitud. Intentá nuevamente más tarde.' });
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const rateKey = createHmac('sha256', secret).update(ip).digest('hex');
  try {
    const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc('register_marketing_demo', { p_id: id, p_name: input.name, p_company: input.company, p_email: input.email, p_message: input.message, p_rate_key: rateKey });
    if (error) return res.status(503).json({ error: 'No pudimos registrar tu solicitud. Tus datos siguen en el formulario.' });
    if (data === 'rate_limited') return res.status(429).json({ error: 'Ya recibimos varias solicitudes. Esperá unos minutos para volver a intentar.' });
    if (data !== 'ok') return res.status(503).json({ error: 'No pudimos confirmar tu solicitud. Intentá nuevamente.' });
    return res.status(200).json({ ok: true });
  } catch { return res.status(503).json({ error: 'No pudimos conectar. Intentá nuevamente.' }); }
}

