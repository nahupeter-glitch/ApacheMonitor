import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { ApacheMonitor, PAUSA, parseQueue } from './worker.mjs';
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
test('toma el cupo para calcular vendidas y descarta cupos incoherentes', () => {
  const [a,b,c]=normalize({ok:true,seatCategories:[
    {seatCategoryId:1,label:'GENERAL - SUR ALTA',availability:768,quota:1000,chargePrice:149500},
    {seatCategoryId:2,label:'PLATEA X',availability:5,quota:2,chargePrice:200000},
    {seatCategoryId:3,label:'PLATEA Y',availability:0,chargePrice:200000}]});
  assert.equal(a.quota,1000); assert.equal(a.quota-a.available,232);
  assert.equal(b.quota,null); assert.equal(c.quota,null);
});
test('en pausa /data.json no entrega datos ni toca el recolector', async () => {
  const prev=PAUSA.activa; PAUSA.activa=true;
  const env={MONITOR:{idFromName(){throw Error('No debe tocar el recolector')}},ASSETS:{fetch:()=>new Response('asset')}};
  const body=await (await worker.fetch(new Request('https://x/data.json'),env)).json();
  assert.equal(body.pausa,true); assert.equal(body.sectors,undefined); assert.match(body.mensaje,/pausa/);
  PAUSA.activa=prev;
});
test('lee la fila y mide el ritmo entre lecturas', () => {
  const t0=Date.parse('2026-11-27T15:36:00Z');
  const a=parseQueue({enabled:true,queueDepth:875605,servingTicket:327176,nextTicket:1202781,admissionsPerMinute:200},null,t0);
  assert.equal(a.depth,875605); assert.equal(a.measuredPerMinute,null);
  const b=parseQueue({queueDepth:875000,servingTicket:327276,nextTicket:1202900,admissionsPerMinute:200},a,t0+30000);
  assert.equal(b.measuredPerMinute,200);
  assert.equal(parseQueue({servingTicket:'x'},a,t0),null); assert.equal(parseQueue(null,a,t0),null);
});
