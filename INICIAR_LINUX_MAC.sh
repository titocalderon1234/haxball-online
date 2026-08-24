#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then npm install; fi
echo "El servidor mostrará localhost y las direcciones LAN para otros dispositivos del mismo Wi-Fi."
npm start
