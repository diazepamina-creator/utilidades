# Utilidades

App personal para el móvil: material de clase organizado, compartir por el menú
de Android y herramientas de PDF (tapar nombres, reducir, unir, páginas, escanear).
Funciona sin conexión. No lleva datos: el material y el token viven solo en el móvil.

Librerías en `lib/`: pdf.js (Apache 2.0), pdf-lib (MIT) y qrcode-generator (MIT), con sus licencias.

- `pizarra.html`: las fichas en la pizarra con un USB-llave (la llave no está aquí).
- `apk/` y `.github/workflows/apk.yml`: la misma app como APK de Android (Capacitor), compilada
  por GitHub Actions en [Releases](https://github.com/diazepamina-creator/utilidades/releases/latest).
  La firma no está aquí: va en los secretos `APK_FIRMA` y `APK_CLAVE`. `capacitor.js` (MIT) solo
  hace algo dentro de la APK.
