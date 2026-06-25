#!/bin/bash
# instalar-libs.sh — Descarga las librerías JS para EtiLabel (modo offline)
# Ejecutar UNA SOLA VEZ con conexión a internet.

set -e
mkdir -p libs

echo "⬇️  Descargando pdf.js..."
curl -fL "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" \
     -o libs/pdf.min.js

echo "⬇️  Descargando pdf.worker.js..."
curl -fL "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js" \
     -o libs/pdf.worker.min.js

echo "⬇️  Descargando pdf-lib..."
curl -fL "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js" \
     -o libs/pdf-lib.min.js

echo ""
echo "✅ Listo. Carpeta libs/ creada con:"
ls -lh libs/
echo ""
echo "Ahora podés usar etiquetas-ml.html sin internet."
