# HB Online V16 — P2P tipo HaxBall

Esta versión cambia la arquitectura de red respecto de V15.

## Qué hace cada parte

- **Servidor Node / Socket.IO:** lista de salas, crear/entrar, contraseña, chat, admins, kick/ban, equipos, mapas y **signaling WebRTC**.
- **Host de la sala:** el navegador de la persona que creó la sala ejecuta la física a **60 ticks/s** con el mismo `engine.js` de V14.
- **Otros jugadores:** mandan sus teclas directamente al host por `RTCDataChannel` y reciben snapshots directamente del host.
- **El gameplay NO pasa por el servidor Node.**

Esto hace que el ping de la partida dependa principalmente de la distancia/conectividad con el **creador de la sala**, como buscábamos.

## Probar en una sola PC

1. Instalá Node.js 20 o superior.
2. Ejecutá `INICIAR_WINDOWS.bat` o `./INICIAR_LINUX_MAC.sh`.
3. Abrí `http://localhost:3000` en dos navegadores/ventanas.
4. Una ventana crea la sala y la otra entra.
5. El creador es el host autoritativo de la partida.

## Probar entre PCs del mismo Wi‑Fi

1. En **una PC** ejecutá el servidor con `INICIAR_WINDOWS.bat`.
2. La consola muestra algo parecido a:

   `http://192.168.0.25:3000`

3. En los otros dispositivos del mismo Wi‑Fi abrí **esa dirección**.
4. Cualquiera puede crear una sala. El navegador que la crea se convierte en host de esa sala.
5. Los paquetes del juego viajan directamente por WebRTC entre cada jugador y ese host.

Si Windows pregunta por el Firewall de Node.js, permitilo al menos en **redes privadas** para poder abrir la web desde otros dispositivos de la LAN.

## Ping

El número `Ping` dentro de la sala se mide con mensajes enviados por el propio `RTCDataChannel` al host y de vuelta. No es el ping al servidor de lobby.

Por eso, si todos están en el mismo Wi‑Fi, normalmente debería ser muy bajo. Si el host está lejos geográficamente, el ping aumenta aunque el servidor de lobby esté cerca.

## Internet

También se puede desplegar `server.js` en Render. En ese caso Render hace solamente lobby/signaling; una vez establecido WebRTC, la partida sigue siendo directa jugador ↔ host.

La V16 usa STUN para descubrir rutas directas. Algunas redes empresariales, CGNAT/symmetric NAT o firewalls muy restrictivos pueden impedir una conexión P2P directa. Para cubrir prácticamente todos esos casos haría falta agregar un servidor **TURN** como relay; TURN sería un fallback, no el camino normal.

## Qué ya viaja P2P

- inputs de movimiento/patada;
- snapshots de física;
- pelota y jugadores;
- score/estado de kickoff/gol;
- cronómetro/overtime;
- ping directo.

El chat y acciones de sala siguen por Socket.IO porque no afectan el lag de la física.

## Comprobaciones incluidas

`npm run check` valida sintaxis. También podés ejecutar:

`node tests/online_engine_smoke.js`

`node tests/p2p_architecture_test.js`
