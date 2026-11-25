import { normalize, merge } from './model.mjs';

const ENDPOINT = 'https://apache.fantixtickets.com/api/secutix/events/10229236932393/availability?performanceId=10229237774708';
const INTERVAL = 30000;
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/data.json') return env.ASSETS.fetch(request);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Método no permitido', { status: 405, headers: { Allow: 'GET, HEAD' } });
    const stub = env.MONITOR.get(env.MONITOR.idFromName('apache-availability'));
    return stub.fetch(request);
  },
  async scheduled(event, env, ctx) {
    const stub = env.MONITOR.get(env.MONITOR.idFromName('apache-availability'));
    ctx.waitUntil(stub.fetch('https://monitor.internal/ensure'));
  }
};

export class ApacheMonitor {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    // All visitors share this single collector. A read never bypasses its cooldown.
    await this.ctx.blockConcurrencyWhile(async () => {
      if (await this.ctx.storage.getAlarm() === null) {
        const saved = await this.ctx.storage.get('snapshot');
        await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, Date.parse(saved?.retryAfter || '') || 0));
      }
    });
    const saved = await this.ctx.storage.get('snapshot');
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(saved || { intervalSeconds: 30, error: 'Iniciando la primera consulta…' }), { headers });
  }
  async alarm() {
    const now = Date.now();
    const previous = await this.ctx.storage.get('snapshot') || {};
    const due = Math.max(Date.parse(previous.retryAfter || '') || 0, (Date.parse(previous.checkedAt || '') || 0) + INTERVAL);
    if (due > now) { await this.ctx.storage.setAlarm(due); return; }
    // Persist a guard before network I/O: alarm retries cannot hammer the source.
    await this.ctx.storage.put('snapshot', { ...previous, retryAfter: new Date(now + INTERVAL).toISOString() });
    await this.ctx.storage.setAlarm(now + INTERVAL);
    let snapshot, next = now + INTERVAL;
    try {
      const response = await fetch(ENDPOINT, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) {
        const error = new Error(`La fuente respondió HTTP ${response.status}`);
        const retry = response.headers.get('retry-after');
        const retryMs = retry && Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Math.max(0, (Date.parse(retry || '') || 0) - Date.now());
        error.delay = Math.max([403, 429].includes(response.status) ? 3600000 : 60000, retryMs);
        throw error;
      }
      const payload = await response.json();
      const sectors = normalize(payload);
      if (!sectors.length) throw new Error('La fuente no devolvió sectores válidos');
      snapshot = { ...merge(previous, sectors, new Date().toISOString()), title: payload.eventTitle, intervalSeconds: 30 };
    } catch (error) {
      next = Date.now() + (error.delay || 60000);
      snapshot = { ...previous, intervalSeconds: 30, checkedAt: new Date().toISOString(), error: error.message, retryAfter: new Date(next).toISOString() };
    }
    await this.ctx.storage.put('snapshot', snapshot);
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next));
  }
}
