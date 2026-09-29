import { createPrivateKey, sign } from 'node:crypto';

const { APPSTORE_KEY_ID, APPSTORE_ISSUER_ID, APPSTORE_API_KEY_P8_BASE64, BUILD_NUMBER } = process.env;
const appId = '6817152283';
const groupId = '7bf1644d-654f-4b28-b62b-fc7f375f68d3';
if (![APPSTORE_KEY_ID, APPSTORE_ISSUER_ID, APPSTORE_API_KEY_P8_BASE64, BUILD_NUMBER].every(Boolean)) {
  throw new Error('Falta configuración de TestFlight');
}

const key = createPrivateKey(Buffer.from(APPSTORE_API_KEY_P8_BASE64, 'base64'));
const base64url = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${base64url({ alg: 'ES256', kid: APPSTORE_KEY_ID, typ: 'JWT' })}.${base64url({ iss: APPSTORE_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
const token = `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;

async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Apple API ${method} ${path}: ${response.status} ${(await response.text()).slice(0, 1000)}`);
  return response.status === 204 ? null : response.json();
}

let build;
for (let attempt = 0; attempt < 40; attempt++) {
  const builds = await api(`/v1/apps/${appId}/builds?limit=50&sort=-uploadedDate`);
  build = builds.data.find(item => item.attributes.version === BUILD_NUMBER);
  if (build?.attributes.processingState === 'VALID') break;
  if (build?.attributes.processingState === 'INVALID') throw new Error(`El build ${BUILD_NUMBER} fue rechazado por Apple`);
  console.log(`Esperando procesamiento del build ${BUILD_NUMBER} (${attempt + 1}/40)`);
  await new Promise(resolve => setTimeout(resolve, 15000));
}
if (build?.attributes.processingState !== 'VALID') throw new Error(`El build ${BUILD_NUMBER} aún no está procesado`);

await api(`/v1/builds/${build.id}`, 'PATCH', {
  data: { type: 'builds', id: build.id, attributes: { usesNonExemptEncryption: false } },
});

const groupPath = `/v1/betaGroups/${groupId}/relationships/builds`;
const current = await api(groupPath);
if (!current.data.some(item => item.id === build.id)) {
  await api(groupPath, 'POST', { data: [{ type: 'builds', id: build.id }] });
}
const updated = await api(groupPath);
if (!updated.data.some(item => item.id === build.id)) throw new Error('El build no quedó asignado al grupo');
console.log(`Build ${BUILD_NUMBER} habilitado en Equipo Rimonim (${build.id})`);
