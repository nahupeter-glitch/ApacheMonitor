import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApacheMonitor } from './worker.mjs';
import { normalize, merge } from './model.mjs';
function fixture(initial = {}) {
  const values = new Map(Object.entries(initial)); let alarm = null;
  const ctx = { blockConcurrencyWhile: f => f(), storage: {
    get: async k => structuredClone(values.get(k)), put: async (k,v) => values.set(k,structuredClone(v)),
    getAlarm: async () => alarm, setAlarm: async time => { alarm = time; }
  }};
  return { monitor: new ApacheMonitor(ctx, {}), ctx, values, alarm: () => alarm };
}
test('rechaza datos inválidos y conserva base y liberaciones', () => {
  assert.throws(() => normalize({ok:false}));
  const a=merge({},[{id:'1',label:'GENERAL',available:10}], '2026-01-01T00:00:00Z');
  const b=merge(a,[{id:'1',label:'GENERAL',available:12}], '2026-01-01T00:00:30Z');
  assert.equal(b.baseline['1'],10); assert.equal(b.changes[0].delta,2);
});
test('alarma guarda datos; bloqueo conserva la última lectura y persiste pausa', async t => {
  const f=fixture();
  t.mock.method(globalThis,'fetch', async () => Response.json({ok:true,eventTitle:'Apache',seatCategories:[{seatCategoryId:1,label:'GENERAL',availability:10,chargePrice:10000}]}));
  await f.monitor.alarm();
  const good=f.values.get('snapshot'); assert.equal(good.sectors[0].available,10); assert.equal(good.error,null);
  f.values.set('snapshot', { ...good, checkedAt: new Date(Date.now()-31000).toISOString() });
  t.mock.method(globalThis,'fetch', async () => new Response('',{status:429,headers:{'Retry-After':'7200'}}));
  await f.monitor.alarm();
  const bad=f.values.get('snapshot'); assert.equal(bad.updatedAt,good.updatedAt); assert.match(bad.error,/429/); assert.ok(f.alarm()>=Date.now()+7199000);
  t.mock.method(globalThis,'fetch', async () => { throw Error('No debe consultar durante pausa'); });
  await f.monitor.alarm(); assert.equal(f.values.get('snapshot').error,bad.error);
  const restarted=fixture({snapshot:bad}); await restarted.monitor.fetch(new Request('https://test/data.json'));
  assert.equal(restarted.alarm(),Date.parse(bad.retryAfter));
});
test('visitas no consultan la fuente ni adelantan alarma existente', async t => {
  const f=fixture(); t.mock.method(globalThis,'fetch',()=>{throw Error('No debe consultar')});
  await f.monitor.fetch(new Request('https://test/data.json')); const first=f.alarm();
  await f.monitor.fetch(new Request('https://test/data.json')); assert.equal(f.alarm(),first);
});
