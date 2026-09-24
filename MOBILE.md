# Rimonim para Android

La web y Android usan el mismo proyecto Supabase y las mismas cuentas invitadas.
El APK incluye la interfaz en el dispositivo; para confirmar cambios se conecta
con la base compartida. Prefrío, cámaras y carga de pallets de un despacho
guardan operaciones pendientes en el teléfono cuando se pierde la conexión.
La pantalla muestra el estado pendiente y las sincroniza al volver la conexión.
Los demás formularios siguen requiriendo conexión.

## Compilar

1. Configurar en GitHub Actions la variable `VITE_SUPABASE_URL` y el secreto
   `VITE_SUPABASE_ANON_KEY` del proyecto existente. Son los mismos valores
   públicos del frontend web; nunca usar la service role key en Android.
2. Ejecutar el workflow **Android debug build** o enviar cambios a `main`.
3. Descargar el artefacto `rimonim-android-debug` del workflow e instalar el
   APK en un teléfono de prueba. Es una compilación de desarrollo, no una
   distribución firmada para Play Store.

Para compilar localmente: crear `.env.local` con las dos variables, ejecutar
`npm ci`, `npm run mobile:android`, y `cd android && ./gradlew assembleDebug` con
Android SDK instalado. La cámara se abre mediante el plugin nativo de códigos
QR y Android solicita permiso de cámara al usarla por primera vez.

## Sincronización

Las operaciones pendientes se guardan en el almacenamiento privado de la app,
asociadas al usuario autenticado. Cada operación conserva su identificador al
reintentarse; la base de datos confirma una sola vez cada cambio. Un rechazo
aparece en pantalla para corregirlo o descartarlo. No borrar los datos de la
app ni desinstalarla si muestra operaciones pendientes: ambas acciones borran
el almacenamiento local. Antes de usar Android en producción, probar en un
dispositivo real el lector, la pérdida de red y los permisos con un usuario de
prueba, y preparar la firma de distribución.
