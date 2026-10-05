import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import logo from '../src/empaco-logo.svg';
import './style.css';

const auth = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { storageKey: 'empaco-private-web', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
function PrivateWeb() {
  const [session, setSession] = useState(null), [ready, setReady] = useState(false);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [html, setHtml] = useState(''), [owner, setOwner] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false), [reviewers, setReviewers] = useState([]), [target, setTarget] = useState('');
  useEffect(() => {
    auth.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = auth.auth.onAuthStateChange((_event, value) => setSession(value));
    return () => data.subscription.unsubscribe();
  }, []);
  async function request(action, body) {
    const { data } = await auth.auth.getSession();
    const response = await fetch(`/api/private-web${action ? `?action=${action}` : ''}`, {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { Authorization: `Bearer ${data.session?.access_token || ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo completar la solicitud.');
    return result;
  }
  useEffect(() => {
    let active = true;
    setHtml(''); setOwner(false); setError(''); setManage(false);
    if (!session) return;
    const load = () => request('').then(result => { if (active) { setHtml(result.html); setOwner(result.owner); setError(''); } }).catch(e => { if (active) { setHtml(''); setError(e.message); } });
    load();
    // Recheck permission while the page stays open, including after a revocation.
    const timer = setInterval(load, 60000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [session?.user?.id]);
  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const { error } = await auth.auth.signInWithPassword({ email: email.trim(), password }); if (error) throw error; setPassword(''); }
    catch { setError('No pudimos iniciar sesión. Revisá tu email y contraseña.'); }
    finally { setBusy(false); }
  }
  async function refreshAccess() { const result = await request('access'); setReviewers(result.reviewers); }
  async function access(action, value) {
    setBusy(true); setError(''); setNotice('');
    try { const result = await request('', { action, email: value }); setNotice(result.message); setTarget(''); await refreshAccess(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  if (!ready) return <p className="loading">Cargando…</p>;
  if (!session) return <main className="login"><div className="login-card">
    <img src={logo} alt="Empaco" /><h1>Web privada</h1><p>Ingresá con tu email autorizado para navegar el diseño de Empaco.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <form onSubmit={login}><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
    <label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
    <button disabled={busy}>{busy ? 'Ingresando…' : 'Entrar a la web'}</button></form>
    <a href="https://app.empaco.com.ar/forgot-password">¿Olvidaste tu contraseña?</a><p className="small">El acceso a esta web requiere autorización de Jonatan.</p>
  </div></main>;
  return <div className="preview"><header className="preview-bar"><span>Vista privada · Empaco</span><div>
    {owner && <button onClick={async () => { try { await refreshAccess(); setManage(!manage); } catch(e) { setError(e.message); } }}> {manage ? 'Ver diseño' : 'Autorizar personas'}</button>}
    <button onClick={() => { setHtml(''); setOwner(false); auth.auth.signOut({ scope: 'local' }); }}>Salir</button></div></header>
    {error && <p role="alert" className="error status">{error}</p>}
    {manage && owner ? <main className="access-panel"><h1>Personas autorizadas</h1><p>Solo estas personas y vos pueden ver la web. Este permiso no habilita acceso a los procesos del empaque.</p>
    <form onSubmit={e => { e.preventDefault(); access('authorize', target); }}><label htmlFor="reviewer">Email</label><input id="reviewer" type="email" required value={target} onChange={e => setTarget(e.target.value)} /><button disabled={busy}>Autorizar e invitar si no tiene cuenta</button></form>
    {notice && <p role="status">{notice}</p>}
    <ul>{reviewers.map(r => <li key={r.email}><span>{r.email}</span><button disabled={busy} onClick={() => access('revoke', r.email)}>Quitar acceso</button></li>)}</ul>
    <p>Compartí este enlace: <a href="https://empaco.com.ar/">https://empaco.com.ar/</a></p></main> : html ? <iframe title="Diseño web de Empaco" srcDoc={html} sandbox="allow-scripts" /> : !error && <p className="loading">Verificando acceso…</p>}
  </div>;
}
createRoot(document.getElementById('root')).render(<PrivateWeb />);
