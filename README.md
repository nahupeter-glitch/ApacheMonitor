# ApacheMonitor

Monitor independiente de disponibilidad de entradas de Adiós Apache.
Cloudflare Workers sirve el panel y un único Durable Object con SQLite
consulta la API aproximadamente cada 30 segundos, aun sin visitantes.
Conserva la última lectura válida y los 30 movimientos recientes.

## Publicar desde Cloudflare

1. Workers & Pages → Create → Connect GitHub → ApacheMonitor.
2. Nombre del Worker: `apache-monitor` (igual a `wrangler.jsonc`).
3. Rama: `main`. Directorio raíz: `/`.
4. Comando de compilación: dejar vacío.
5. Comando de despliegue: `npx wrangler deploy`.
6. Elegir el plan Workers Free y publicar.
7. Abrir la URL `workers.dev` devuelta por Cloudflare. La primera visita
   inicia el recolector; esperar unos segundos y comprobar `/data.json`.
8. Comprobar que `updatedAt` cambia tras dos lecturas y que, tras cerrar
   todas las pestañas durante unos minutos, el monitor sigue actualizando.

Wrangler crea automáticamente el almacenamiento SQLite y las alarmas.
El cron cada diez minutos recupera el monitor si pierde una alarma.
No necesita dominio propio, tarjeta en el código ni tokens en GitHub.
Los límites gratuitos son compartidos con otros proyectos de la cuenta.
No cambiar a un plan pago para este despliegue.

## Desarrollo

Node.js 22 o superior. `npm install`, `npm test`, `npm run dev`.
Para despliegue local autenticado: `npx wrangler login`, `npm run deploy`.

## Comportamiento y límites

- Los navegadores leen datos guardados: las visitas no multiplican consultas a la ticketera.
- Errores 403/429 pausan al menos una hora y respetan Retry-After.
- Otros errores pausan al menos un minuto; nunca se reemplazan los datos por ceros.
- Si pasan 90 segundos sin lectura válida, el panel avisa que están desactualizados.
- Los movimientos incluyen reservas y liberaciones: no son ventas confirmadas.
- Las alarmas son aproximadas y no garantizan puntualidad exacta.
- Una prueba local no garantiza acceso a la fuente desde Cloudflare.
  La publicación debe validarse con datos reales desde el servidor.
- No se almacenan compradores, credenciales ni datos personales.

El archivo PowerShell original permanece fuera de este repositorio.
