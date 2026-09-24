import { createClient } from '@supabase/supabase-js';
import { readSnapshot, saveSnapshot } from '@/lib/offlineStore';
import { Capacitor } from '@capacitor/core';
const webAppUrl = import.meta.env.VITE_PUBLIC_APP_URL || 'https://empaque-rimonim.vercel.app';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder', {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
});
const requireConfigured = () => { if (!url || !key) throw new Error('Configurá VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY'); };
/** @param {{ data?: any, error?: Error | null }} result */
function unwrap({ data, error }) { if (error) throw error; return data; }
async function rows(entity) {
  const { data: { session } } = await supabase.auth.getSession();
  const ownerId = session?.user?.id;
  if (!ownerId) throw Object.assign(new Error('Iniciá sesión'), {status:401});
  if (!navigator.onLine) {
    const cached = await readSnapshot(ownerId, entity);
    if (cached) return cached;
    throw new Error('No hay datos de esta sección guardados para usar sin conexión');
  }
  const all=[];
  try {
    for(let offset=0; ; offset+=1000) {
      const batch=unwrap(await supabase.from('records').select('id,data,created_date').eq('entity',entity).order('created_date',{ascending:true}).order('id',{ascending:true}).range(offset,offset+999));
      all.push(...batch);
      if(batch.length<1000) {
        await saveSnapshot(ownerId, entity, all).catch(() => {});
        return all;
      }
    }
  } catch (error) {
    if (!navigator.onLine || error?.status === 0 || /failed to fetch|networkerror/i.test(error?.message || '')) {
      const cached = await readSnapshot(ownerId, entity);
      if (cached) return cached;
    }
    throw error;
  }
}
const flatten = (record) => ({ ...record.data, id: record.id, created_date: record.created_date });
/** @param {string} entity */
const entityClient = (entity) => ({
  async list(order = '-created_date', limit) {
    requireConfigured();
    if (entity === 'User') return unwrap(await supabase.from('profiles').select('id,email,full_name,role')).map(x => ({ ...x, name:x.full_name }));
    // JSON fields cannot be ordered dynamically through PostgREST; sort after retrieval.
    const data = await rows(entity);
    const field = order.replace(/^-/, '');
    const sign = order.startsWith('-') ? -1 : 1;
    const sorted = data.map(flatten).sort((a,b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * sign);
    return limit ? sorted.slice(0,limit) : sorted;
  },
  async filter(query) { return (await this.list()).filter(row => Object.entries(query).every(([k,v]) => row[k] === v)); },
  async get(id) { const data = unwrap(await supabase.from('records').select('id,data,created_date').eq('entity',entity).eq('id',id).single()); return flatten(data); },
  async create(record) {
    const id = crypto.randomUUID();
    const data = unwrap(await supabase.from('records').insert({entity,id,data:{...record,id}}).select('id,data,created_date').single());
    return flatten(data);
  },
  async bulkCreate(records) {
    if (!records.length) return [];
    const data = unwrap(await supabase.from('records').insert(records.map(record=>{const id=crypto.randomUUID();return {entity,id,data:{...record,id}}})).select('id,data,created_date'));
    return data.map(flatten);
  },
  async update(id, patch) {
    if(entity==='User') { const data=unwrap(await supabase.from('profiles').update({role:patch.role}).eq('id',id).select().single()); return data; }
    const data=unwrap(await supabase.rpc('patch_record',{p_entity:entity,p_id:id,p_patch:patch,p_unset:[]}));
    return flatten(data);
  },
  async bulkUpdate(records) { return Promise.all(records.map(({id,...patch}) => this.update(id,patch))); },
  async updateMany(query, patch) {
    const changes = patch.$set || (patch.$unset ? {} : patch);
    const unset = Object.keys(patch.$unset || {});
    // La función SQL compara el id como texto; el operador $in de Base44
    // requiere actualizar cada registro por su id real.
    if (Array.isArray(query.id?.$in)) {
      return Promise.all(query.id.$in.map(id =>
        supabase.rpc('patch_record', {
          p_entity: entity, p_id: id,
          p_patch: changes,
          p_unset: unset,
        }).then(unwrap).then(flatten)
      ));
    }
    const data=unwrap(await supabase.rpc('patch_records',{p_entity:entity,p_query:query,p_patch:changes,p_unset:unset}));
    return data.map(flatten);
  },
  async delete(id) { unwrap(await supabase.from('records').delete().eq('entity',entity).eq('id',id)); },
});
const profile = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) throw Object.assign(new Error('Iniciá sesión'), {status:401});
  try {
    if (!navigator.onLine) throw new TypeError('Sin conexión');
    const {data:{user},error} = await supabase.auth.getUser();
    if(error || !user) throw Object.assign(new Error('Iniciá sesión'),{status:401});
    const p=unwrap(await supabase.from('profiles').select('*').eq('id',user.id).single());
    const value={...p, name:p.full_name};
    await saveSnapshot(user.id, 'profile', value).catch(() => {});
    return value;
  } catch (error) {
    if (!navigator.onLine || error instanceof TypeError || error?.status === 0) {
      const cached = await readSnapshot(session.user.id, 'profile');
      if (cached) return cached;
    }
    throw error;
  }
};
export const base44 = {
  app: {getPublicSettings: async()=>({id:'empaque-rimonim',public_settings:{}})},
  auth: {
    me: profile,
    isAuthenticated: async()=>!!(await supabase.auth.getSession()).data.session,
    async loginViaEmailPassword(email,password) { requireConfigured(); unwrap(await supabase.auth.signInWithPassword({email,password})); return profile(); },
    loginWithProvider: async (_provider,returnTo='/')=>{ requireConfigured(); unwrap(await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:new URL(returnTo,location.origin).href}})); },
    logout: async(returnTo)=>{ unwrap(await supabase.auth.signOut()); if(returnTo) location.assign('/login'); },
    redirectToLogin: ()=>location.assign('/login'),
    async verifyOtp({email,otpCode}) { const data=unwrap(await supabase.auth.verifyOtp({email,token:otpCode,type:'email'})); return {access_token:data.session?.access_token}; },
    setToken:()=>{},
    resendOtp: email=>supabase.auth.resend({type:'signup',email}).then(unwrap),
    resetPasswordRequest: email=>supabase.auth.resetPasswordForEmail(email,{redirectTo:`${Capacitor.isNativePlatform() ? webAppUrl : location.origin}/reset-password`}).then(unwrap),
    resetPassword: ({newPassword})=>supabase.auth.updateUser({password:newPassword}).then(unwrap),
  },
  users: {async inviteUser(email,role) { const session=unwrap(await supabase.auth.getSession()).session; const endpoint=Capacitor.isNativePlatform() ? `${webAppUrl}/api/invite` : '/api/invite'; const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token}`},body:JSON.stringify({email,role})}); const body=await response.json(); if(!response.ok) throw new Error(body.error||'No se pudo invitar'); return body; }},
  entities: /** @type {Record<string, ReturnType<typeof entityClient>>} */ (new Proxy({}, {get:(_target,name)=>entityClient(String(name))})),
};
