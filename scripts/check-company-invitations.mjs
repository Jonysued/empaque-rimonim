import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=(await readFile('api/invite.js','utf8')).replace(/^import .*;\n/gm,'').replace('export default async function handler','async function handler');
const ca='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',cb='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const writes=[];
let inviteCalls=0;
let existing=true,pending=false,mailFailure=null,duplicate=false;
const redirects=[];
const createClient=(_url,key,options)=> {
 if(key==='secret') return {
  auth:{resetPasswordForEmail:async(_email,options)=>{inviteCalls++;redirects.push(options.redirectTo);return {error:mailFailure};},admin:{getUserById:async()=>({data:{user:{email_confirmed_at:pending?null:'confirmed'}},error:null}),inviteUserByEmail:async(_email,options)=>{inviteCalls++;redirects.push(options.redirectTo);return {data:{user:{id:'new-client-user'}},error:mailFailure};}}},
  from:table=> table==='profiles'?{select:()=>({eq:()=>({maybeSingle:async()=>({data:existing?{id:'existing-client-user'}:null,error:null})})})}:{insert:async row=>{writes.push(row);return {error:duplicate?{code:'23505'}:null};}}
 };
 const company=options.global.headers['x-empaco-company'] || ca;
 const query={eq:()=>query,single:async()=>({data:{id:ca,slug:'other-company'},error:null})};
 return {auth:{getUser:async()=>({data:{user:{id:'company-admin'}},error:null})},rpc:async()=>({data:company===ca?'admin':'user',error:null}),from:()=>({select:()=>query})};
};
const saved={...process.env};
Object.assign(process.env,{VITE_SUPABASE_URL:'https://example.test',VITE_SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'secret',APP_URL:'https://app.example.test'});
const handler=new Function('createClient',`${source};return handler;`)(createClient);
const run=async body=> {
 const response={code:null,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;},setHeader(){},end(){}};
 await handler({method:'POST',headers:{authorization:'Bearer fake'},body},response);return response;
};
try {
 assert.equal((await run({email:'client@example.test',role:'admin',company_id:cb})).code,403);
 assert.equal(writes.length,0);
 assert.equal((await run({email:'client@example.test',role:'superuser',company_id:ca})).code,400);
 const ok=await run({email:'client@example.test',role:'frio',company_id:ca});
 assert.equal(ok.code,200);assert.equal(ok.body.existing,true);
 assert.deepEqual(writes,[{company_id:ca,user_id:'existing-client-user',role:'frio'}]);
 assert.equal(inviteCalls,0);
 existing=false;
 const fresh=await run({email:'new@example.test',role:'frio',company_id:ca});
 assert.equal(fresh.code,200);assert.equal(fresh.body.email_sent,true);
 assert.equal(redirects.at(-1),'https://app.example.test/reset-password');
 existing=true;pending=true;duplicate=true;
 const retry=await run({email:'pending@example.test',role:'frio',company_id:ca});
 assert.equal(retry.code,200);assert.equal(retry.body.email_sent,true);
 const sent=inviteCalls;
 pending=false;
 assert.equal((await run({email:'existing@example.test',role:'frio',company_id:ca})).code,409);
 assert.equal(inviteCalls,sent);
 existing=false;duplicate=false;mailFailure={status:429,code:'over_email_send_rate_limit'};
 const limited=await run({email:'limited@example.test',role:'frio',company_id:ca});
 assert.equal(limited.code,429);assert.match(limited.body.error,/límite/);
 mailFailure={status:400,code:'email_address_not_authorized'};
 const blocked=await run({email:'blocked@example.test',role:'frio',company_id:ca});
 assert.equal(blocked.code,502);assert.match(blocked.body.error,/proveedor/);
 console.log('PASS: tenant authorization, new invitation password link, pending invitation retry, no confirmed-user mail, explicit provider/rate-limit failures; all email calls mocked.');
} finally {for(const key of ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','APP_URL']) if(saved[key]===undefined) delete process.env[key];else process.env[key]=saved[key];}
