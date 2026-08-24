@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado. Instala Node.js 20 o superior y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install
  if errorlevel 1 (
    echo No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
)
echo.
echo El servidor mostrara localhost y las direcciones de tu red local.
echo Para jugar desde otro dispositivo del mismo Wi-Fi, usa la direccion 192.168.x.x que aparezca.
echo Si Windows pregunta por Firewall, permite Node.js en redes privadas.
echo Para cerrar el servidor, presiona Ctrl+C.
echo.
call npm start
pause
