import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile('src/api/base44Client.js','utf8');
const body=source.slice(source.indexOf('const profile = async () => {'),source.indexOf('export const base44'));
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const user={id:'owner'};let networkError=null;
const supabase={auth:{getSession:async()=>({data:{session:{user}}}),getUser:async()=>({data:{user:networkError?null:user},error:networkError})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{id:'owner',role:'frio'},error:null})})})})};
const cache=new Map();const saveSnapshot=async(id,key,value)=>cache.set(`${id}:${key}`,value);
const readSnapshot=async(id,key)=>cache.get(`${id}:${key}`);
const profile=new Function('supabase','Capacitor','readLastOwner','readSnapshot','saveSnapshot','saveLastOwner','unwrap',`${body};return profile;`)(supabase,{isNativePlatform:()=>true},async()=>user.id,readSnapshot,saveSnapshot,async()=>{},({data,error})=>{if(error)throw error;return data;});
assert.equal((await profile()).role,'frio');
networkError=Object.assign(new Error('Failed to fetch'),{name:'AuthRetryableFetchError',status:0});
assert.equal((await profile()).role,'frio'); // Navigator can say online while the radio is disconnected.
networkError=Object.assign(new Error('Invalid JWT'),{status:401});
await assert.rejects(profile(),/Invalid JWT/); // Real session rejection never uses cached credentials.
navigator.onLine=false;
assert.equal((await profile()).role,'frio');
console.log('PASS: desconexión con señal aparente conserva el perfil; sesión rechazada no usa caché; arranque nativo offline');
