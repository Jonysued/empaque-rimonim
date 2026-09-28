# Rimonim para Android y iPhone

La web y las apps móviles usan el mismo proyecto Supabase y las mismas cuentas invitadas.
Cada app incluye la interfaz en el dispositivo y prepara una copia de las listas
operativas al iniciarse con internet. Prefrío, cámaras, carga de pallets de un
despacho, vuelco de BINs y nuevos lotes de ingreso guardan operaciones pendientes
al perder la conexión.
La pantalla muestra el estado pendiente y las sincroniza al volver la conexión.
Los demás formularios (como crear pallets y cargas o editar catálogos)
siguen requiriendo conexión. La copia local es una referencia del último
estado confirmado: no incluye cambios de otros dispositivos hasta reconectar.
Se necesita iniciar sesión con internet al menos una vez. Si la sesión vence
sin señal, el usuario previamente autenticado puede consultar su copia local
y guardar movimientos en la cola; se vuelven a autorizar en el servidor al
reconectar. Cerrar sesión borra la identidad local para uso sin conexión.

## Android

1. Configurar en GitHub Actions la variable `VITE_SUPABASE_URL` y el secreto
   `VITE_SUPABASE_ANON_KEY` del proyecto existente. Son los mismos valores
   públicos del frontend web; nunca usar la service role key en una app móvil.
2. Ejecutar el workflow **Android debug build** o enviar cambios a `main`.
3. Descargar el artefacto `rimonim-android-debug` del workflow e instalar el
   APK en un teléfono de prueba. Es una compilación de desarrollo, no una
   distribución firmada para Play Store.

Para compilar localmente: crear `.env.local` con las dos variables, ejecutar
`npm ci`, `npm run mobile:android`, y `cd android && ./gradlew assembleDebug` con
Android SDK instalado. La cámara se abre mediante el plugin nativo de códigos
QR y Android solicita permiso de cámara al usarla por primera vez.

## iPhone

El proyecto Xcode está en `ios/`. Con un Mac y Xcode compatible con Capacitor 8,
configurar `.env.local` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` del
mismo proyecto que usa la web, ejecutar `npm ci`, `npm run mobile:ios:sync` y
abrir `ios/App/App.xcodeproj` en Xcode. Seleccionar el equipo de Apple Developer
y configurar la firma para `app.rimonim.empaque`. El permiso de cámara para QR
está declarado en `Info.plist`.

Para instalar en teléfonos del equipo, archivar y subir una versión firmada a
App Store Connect y distribuirla por TestFlight. No se instala un APK en iOS.
El proyecto generado y su sincronización no sustituyen una compilación en Mac
ni las pruebas de cámara, sesión y cola offline en un iPhone real.

## Sincronización

Las operaciones pendientes se guardan en el almacenamiento privado de la app,
asociadas al usuario autenticado. Cada operación conserva su identificador al
reintentarse; la base de datos confirma una sola vez cada cambio. Un rechazo
aparece en pantalla para corregirlo o descartarlo. No borrar los datos de la
app ni desinstalarla si muestra operaciones pendientes: ambas acciones borran
el almacenamiento local. Antes de usar Android en producción, probar en un
dispositivo real el lector, la pérdida de red y los permisos con un usuario de
prueba, y preparar la firma de distribución.
