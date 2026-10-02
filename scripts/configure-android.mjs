import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';

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

 // Apply the original Rimonim O and crown to every launcher density.
const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
for (const density of densities) {
  const directory = `android/app/src/main/res/mipmap-${density}`;
  await mkdir(directory, { recursive: true });
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    await copyFile(`resources/icons/${density}.png`, `${directory}/${name}.png`);
  }
  await copyFile(`resources/icons/${density}-foreground.png`, `${directory}/ic_launcher_foreground.png`);
}
const adaptiveDirectory = 'android/app/src/main/res/mipmap-anydpi-v26';
await mkdir(adaptiveDirectory, { recursive: true });
const adaptiveIcon = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@android:color/white"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>\n';
for (const name of ['ic_launcher', 'ic_launcher_round']) {
  await writeFile(`${adaptiveDirectory}/${name}.xml`, adaptiveIcon);
}
const appGradle = 'android/app/build.gradle';
const gradle = await readFile(appGradle, 'utf8');
await writeFile(appGradle, gradle.replace(/versionCode \d+/, 'versionCode 9'));
