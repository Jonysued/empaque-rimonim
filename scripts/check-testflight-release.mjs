import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
process.env.APPSTORE_KEY_ID='test';process.env.APPSTORE_ISSUER_ID='test';process.env.APPSTORE_API_KEY_P8_BASE64=Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64');
delete process.env.RELEASE_CONFIG; delete process.env.GITHUB_STEP_SUMMARY;
process.env.BUILD_NUMBER='9';process.env.RELEASE_EXTERNAL='true';
const group='10a97d53-d7aa-45a4-b59b-c34eb20cc56e',internal='7bf1644d-654f-4b28-b62b-fc7f375f68d3';
let wrong=false,assigned=false,notify=false,mutations=[];
globalThis.fetch=async (url,opts={})=>{
 const p=new URL(url).pathname;let data;
 if(opts.method!=='GET' && opts.method){mutations.push(p);if(p.includes('/buildBetaDetails/'))notify=true;if(p.includes(group))assigned=true;return {ok:true,status:204};}
 if(p.includes('/apps/'))data=[{id:'build9',attributes:{version:'9',processingState:'VALID'}}];
 else if(p.endsWith('/betaTesters'))data=[{attributes:{firstName:'Reynaldo'}},{attributes:{firstName:wrong?'Otra persona':'Joaquín'}}];
 else if(p.endsWith('/app'))data={id:'6817152283'};
 else if(p.endsWith('/buildBetaDetail'))data={id:'detail9',attributes:{autoNotifyEnabled:notify,externalBuildState:'BETA_TESTING'}};
 else if(p.includes(internal))data=[{id:'build9'}];
 else if(p.includes(group)&&p.endsWith('/builds'))data=assigned?[{id:'build9'}]:[];
 else data={attributes:{isInternalGroup:false}};
 return {ok:true,status:200,json:async()=>({data})};
};
wrong=true;await assert.rejects(import('./finalize-testflight.mjs?wrong-group'),/no coincide/);assert.deepEqual(mutations,[]);
wrong=false;await import('./finalize-testflight.mjs?release');assert.ok(assigned);assert.ok(notify);assert.equal(mutations.length,2);
mutations=[];await import('./finalize-testflight.mjs?retry');assert.deepEqual(mutations,[]);
console.log('Distribución externa: valida los dos destinatarios, activa aviso y no repite cambios al reintentar: OK');
