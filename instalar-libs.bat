@echo off
REM instalar-libs.bat — Descarga las librerias JS para EtiLabel (modo offline)
REM Ejecutar UNA SOLA VEZ con conexion a internet.

echo Creando carpeta libs...
if not exist libs mkdir libs

echo Descargando pdf.js...
curl -fL "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" -o libs\pdf.min.js

echo Descargando pdf.worker.js...
curl -fL "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js" -o libs\pdf.worker.min.js

echo Descargando pdf-lib...
curl -fL "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js" -o libs\pdf-lib.min.js

echo.
echo Listo. Ahora podes usar etiquetas-ml.html sin internet.
echo.
pause
