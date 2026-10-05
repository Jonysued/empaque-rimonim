import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=(await readFile('api/invite.js','utf8')).replace(/^import .*;\n/gm,'').replace('export default async function handler','async function handler');
const ca='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',cb='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const writes=[];
let inviteCalls=0;
const createClient=(_url,key,options)=> {
 if(key==='secret') return {
  auth:{admin:{inviteUserByEmail:async()=>{inviteCalls++;throw Error('Unexpected mail');}}},
  from:table=> table==='profiles'?{select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'existing-client-user'},error:null})})})}:{insert:async row=>{writes.push(row);return {error:null};}}
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
 console.log('PASS: invitaciones verifican administrador de la empresa; cuentas existentes reciben solo la membresía solicitada; sin enviar emails de prueba');
} finally {for(const key of ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','APP_URL']) if(saved[key]===undefined) delete process.env[key];else process.env[key]=saved[key];}
