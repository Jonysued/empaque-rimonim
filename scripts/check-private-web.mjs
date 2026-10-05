import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { PGlite } from '@electric-sql/pglite';

const allowed = new Set(['viewer@example.test']);
let identity = { id: 'viewer-id', email: 'viewer@example.test', email_confirmed_at: '2026-10-05' };
let contentReads = 0, emails = 0;
const createClient = (_url, key) => key === 'anon' ? { auth: { getUser: async () => ({ data: { user: identity }, error: null }) } } : {
  auth: { admin: { inviteUserByEmail: async () => { emails++; throw Error('Unexpected email'); } } },
  from(table) {
    const query = {
      select() { return query; },
      eq(_column, value) { query.value = value; return query; },
      maybeSingle: async () => ({ data: table === 'profiles' ? { id: 'existing-account' } : allowed.has(query.value) ? { email: query.value } : null, error: null }),
      single: async () => { contentReads++; return { data: { html_gzip_base64: gzipSync('<h1>Private design</h1>').toString('base64') }, error: null }; },
      order: async () => ({ data: [...allowed].map(email => ({ email })), error: null }),
      upsert: async row => { allowed.add(row.email); return { error: null }; },
      delete() { return { eq: async (_column, email) => { allowed.delete(email); return { error: null }; } }; },
    };
    return query;
  },
};
const source = (await readFile('api/private-web.js', 'utf8')).replace(/^import .*;\n/gm, '').replace('export default async function handler', 'async function handler');
const handler = new Function('createClient', 'gunzipSync', `${source}; return handler;`)(createClient, gunzipSync);
Object.assign(process.env, { VITE_SUPABASE_URL: 'https://example.test', VITE_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'secret' });
async function run({ token = true, method = 'GET', body, action } = {}) {
  const response = { headers: {}, code: null, body: null, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method, headers: token ? { authorization: 'Bearer fake' } : {}, body, query: { action } }, response);
  return response;
}
assert.equal((await run({ token: false })).code, 401);
assert.equal(contentReads, 0);
identity = { ...identity, email: 'other-admin@example.test', user_metadata: { email: 'jonatan@rimonim.com.ar', role: 'admin' } };
assert.equal((await run()).code, 403);
assert.equal(contentReads, 0);
identity = { ...identity, email: 'viewer@example.test' };
const page = await run();
assert.equal(page.body.html, '<h1>Private design</h1>');
assert.match(page.headers['Cache-Control'], /no-store/);
assert.equal((await run({ method: 'POST', body: { action: 'authorize', email: 'attacker@example.test' } })).code, 403);
assert.equal((await run({ action: 'access' })).code, 403);
identity = { ...identity, email: 'jonatan@rimonim.com.ar' };
assert.equal((await run({ method: 'POST', body: { action: 'authorize', email: 'new-viewer@example.test' } })).code, 200);
assert(allowed.has('new-viewer@example.test'));
assert.equal(emails, 0);
assert.equal((await run({ method: 'POST', body: { action: 'revoke', email: 'viewer@example.test' } })).code, 200);
identity = { ...identity, email: 'viewer@example.test' };
const readsBefore = contentReads;
assert.equal((await run()).code, 403);
assert.equal(contentReads, readsBefore);
identity = { ...identity, email: 'jonatan@rimonim.com.ar', email_confirmed_at: null };
assert.equal((await run()).code, 401);

const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create table public.profiles(id uuid primary key);');
await db.exec(await readFile('supabase/migrations/20261005151326_private_website_access.sql', 'utf8'));
for (const role of ['anon', 'authenticated']) {
  const { rows } = await db.query(`select has_table_privilege($1,'public.private_web_design','select') as design, has_table_privilege($1,'public.private_web_access','insert') as access`, [role]);
  assert.equal(rows[0].design, false); assert.equal(rows[0].access, false);
}
await db.close();
console.log('PASS: private design rejects anonymous, unlisted admins, editable identity claims and revoked viewers; only verified owner manages access; no test emails; database denies direct client access.');
