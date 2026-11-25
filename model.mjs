export function normalize(payload) {
  if (payload.ok !== true || !Array.isArray(payload.seatCategories) || !payload.seatCategories.length) throw new Error('Respuesta de disponibilidad inválida');
  return payload.seatCategories.filter(s => s.chargePrice >= 10000).map(s => {
    if (!Number.isSafeInteger(s.availability) || s.availability < 0 || !Number.isFinite(s.chargePrice) || typeof s.label !== 'string') throw new Error('Sector inválido');
    return { id: String(s.seatCategoryId), label: s.label, available: s.availability, price: s.chargePrice, level: s.availabilityLevel };
  });
}
export function merge(previous, sectors, now) {
  const baseline = { ...previous.baseline };
  const changes = [];
  for (const s of sectors) {
    baseline[s.id] ??= s.available;
    const old = previous.sectors?.find(p => p.id === s.id);
    if (old && old.available !== s.available) changes.push({ time: now, label: s.label, delta: s.available - old.available, available: s.available });
  }
  return { ...previous, updatedAt: now, checkedAt: now, baselineAt: previous.baselineAt || now, baseline, sectors, changes: [...changes, ...(previous.changes || [])].slice(0, 30), error: null, retryAfter: null };
}

