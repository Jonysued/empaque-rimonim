import { readFile, writeFile } from 'node:fs/promises';

const variables = 'android/variables.gradle';
const manifest = 'android/app/src/main/AndroidManifest.xml';
const contents = await readFile(variables, 'utf8');
if (!/minSdkVersion = \d+/.test(contents)) throw new Error('No se encontró minSdkVersion de Android');
await writeFile(variables, contents.replace(/minSdkVersion = \d+/, 'minSdkVersion = 26'));

const xml = await readFile(manifest, 'utf8');
if (!xml.includes('android.permission.CAMERA')) {
  if (!xml.includes('</manifest>')) throw new Error('No se encontró el cierre de AndroidManifest.xml');
  await writeFile(manifest, xml.replace('</manifest>', '    <uses-permission android:name="android.permission.CAMERA" />\n</manifest>'));
}
