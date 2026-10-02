import { readFile } from 'node:fs/promises';
import { createPrivateKey, sign, createHash } from 'node:crypto';

const { APPSTORE_KEY_ID, APPSTORE_ISSUER_ID, APPSTORE_API_KEY_P8_BASE64 } = process.env;
const release = process.env.RELEASE_CONFIG ? JSON.parse(await readFile(process.env.RELEASE_CONFIG, 'utf8')) : {};
const BUILD_NUMBER = process.env.BUILD_NUMBER || release.build_number;
const externalRelease = process.env.RELEASE_EXTERNAL === 'true' || release.external === true;
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
  const builds = await api(`/v1/apps/${appId}/builds?limit=50`);
  build = builds.data.find(item => item.attributes.version === BUILD_NUMBER);
  if (build?.attributes.processingState === 'VALID') break;
  if (build?.attributes.processingState === 'INVALID') throw new Error(`El build ${BUILD_NUMBER} fue rechazado por Apple`);
  console.log(`Esperando procesamiento del build ${BUILD_NUMBER} (${attempt + 1}/40)`);
  await new Promise(resolve => setTimeout(resolve, 15000));
}
if (build?.attributes.processingState !== 'VALID') throw new Error(`El build ${BUILD_NUMBER} aún no está procesado`);

const groupPath = `/v1/betaGroups/${groupId}/relationships/builds`;
const current = await api(groupPath);
if (!current.data.some(item => item.id === build.id)) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await api(groupPath, 'POST', { data: [{ type: 'builds', id: build.id }] });
      break;
    } catch (error) {
      if (!String(error).includes('422') || attempt === 19) throw error;
      console.log('Esperando que Apple habilite la prueba interna');
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }
}
const updated = await api(groupPath);
if (!updated.data.some(item => item.id === build.id)) throw new Error('El build no quedó asignado al grupo');
console.log(`Build ${BUILD_NUMBER} habilitado en Equipo Rimonim (${build.id})`);

if (externalRelease) {
  const externalGroupId = '10a97d53-d7aa-45a4-b59b-c34eb20cc56e';
  const [group, groupApp, testers] = await Promise.all([
    api(`/v1/betaGroups/${externalGroupId}`), api(`/v1/betaGroups/${externalGroupId}/app`),
    api(`/v1/betaGroups/${externalGroupId}/betaTesters?limit=200`),
  ]);
  // Apple can omit tester names. Match the previously resolved accounts by
  // fingerprint without putting contact addresses in source code or logs.
  const expectedFingerprints = new Set(["affde18ebb2f1cfa1f2bcc69884362f883e9229fe7104366a6c453e6a27e003e", "0ff4c77d067ddc7f8bf04d9d2a5c95145a95e41cbcb91e409d51c416875c46d1", "fff80e2a0e77d6799f97bbfacbed04ec813b837da408d4b5d7ecafc6a378a9a9"]);
  const fingerprints = testers.data.map(t => createHash('sha256').update(String(t.attributes.email || '').trim().toLowerCase()).digest('hex'));
  if (group.data.attributes.isInternalGroup || groupApp.data.id !== appId || testers.links?.next ||
      fingerprints.length !== expectedFingerprints.size || new Set(fingerprints).size !== expectedFingerprints.size || fingerprints.some(f => !expectedFingerprints.has(f))) {
    throw new Error('El grupo externo no coincide con las tres cuentas confirmadas; no se distribuyó la actualización');
  }
  console.log('Grupo externo verificado: 3 testers existentes');
  if (release.what_to_test) {
    const localizations = await api(`/v1/builds/${build.id}/betaBuildLocalizations`);
    const localization = localizations.data.find(l => l.attributes.locale === 'es-ES');
    if (localization) {
      if (localization.attributes.whatsNew !== release.what_to_test) await api(`/v1/betaBuildLocalizations/${localization.id}`, 'PATCH', {
        data: { type: 'betaBuildLocalizations', id: localization.id, attributes: { whatsNew: release.what_to_test } },
      });
    } else await api('/v1/betaBuildLocalizations', 'POST', {
      data: { type: 'betaBuildLocalizations', attributes: { locale: 'es-ES', whatsNew: release.what_to_test }, relationships: { build: { data: { type: 'builds', id: build.id } } } },
    });
  }
  // Enable Apple's notification before assigning the new build. Retries do not
  // send an extra manual notification or create/invite any tester.
  let detail = (await api(`/v1/builds/${build.id}/buildBetaDetail`)).data;
  if (!detail.attributes.autoNotifyEnabled) await api(`/v1/buildBetaDetails/${detail.id}`, 'PATCH', {
    data: { type: 'buildBetaDetails', id: detail.id, attributes: { autoNotifyEnabled: true } },
  });
  const externalPath = `/v1/betaGroups/${externalGroupId}/relationships/builds`;
  const assigned = await api(externalPath);
  if (!assigned.data.some(b => b.id === build.id)) await api(externalPath, 'POST', { data: [{ type: 'builds', id: build.id }] });
  detail = (await api(`/v1/builds/${build.id}/buildBetaDetail`)).data;
  if (detail.attributes.externalBuildState === 'READY_FOR_BETA_SUBMISSION') {
    const submissions = await api(`/v1/betaAppReviewSubmissions?filter[build]=${build.id}`);
    if (!submissions.data.length) await api('/v1/betaAppReviewSubmissions', 'POST', {
      data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } },
    });
    detail = (await api(`/v1/builds/${build.id}/buildBetaDetail`)).data;
  }
  for (let attempt = 0; attempt < 12 && detail.attributes.externalBuildState === 'READY_FOR_BETA_TESTING'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    detail = (await api(`/v1/builds/${build.id}/buildBetaDetail`)).data;
  }
  const verified = await api(externalPath);
  if (!verified.data.some(b => b.id === build.id) || !detail.attributes.autoNotifyEnabled) throw new Error('No quedó confirmada la distribución externa');
  console.log(`Build ${BUILD_NUMBER} asignado al grupo externo existente; estado externo: ${detail.attributes.externalBuildState}; notificación automática activada`);
  if (process.env.GITHUB_STEP_SUMMARY) await import('node:fs/promises').then(({appendFile}) => appendFile(process.env.GITHUB_STEP_SUMMARY,
    `### Empaco 1.0 (${BUILD_NUMBER})\n- Grupo verificado: 3 testers existentes.\n- Estado de Apple: ${detail.attributes.externalBuildState}.\n- Aviso automático de la actualización: activado.\n- No se agregaron testers ni permisos.\n`));
}
