export const QUOTA_BASELINE_SCHEMA = 1;

export function historyLiveStartFor(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error('Date invalide pour la fenêtre historique.');
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}

// On garde en temps réel uniquement le mois courant. Au changement de mois,
// la baseline est reconstruite une seule fois puis le nouveau mois repart léger.
export const HISTORY_LIVE_START = historyLiveStartFor();

const canonicalIds = values => [...new Set((values || []).filter(Boolean).map(String))].sort();

const normalizeGroup = (group = {}, fallbackSource = 'app') => [
  String(group.id || ''),
  canonicalIds(group.members || group.participants || []),
  String(group.driver || group.driverId || ''),
  String(group.source || fallbackSource || 'app')
];

const decodeGroup = row => ({
  ...(row?.[0] ? { id: row[0] } : {}),
  members: canonicalIds(row?.[1] || []),
  driver: String(row?.[2] || ''),
  source: String(row?.[3] || 'app')
});

const archiveOnly = (docs, liveStart) => (docs || []).filter(d => String(d?.id || '') < liveStart);

export function makeArchiveBaseline({
  tripDaysDocs = [],
  availabilityDocs = [],
  legacyStatusDocs = [],
  plansDocs = [],
  liveStart = HISTORY_LIVE_START,
  generatedAtMs = Date.now(),
  generation = String(generatedAtMs)
} = {}) {
  const tripDays = archiveOnly(tripDaysDocs, liveStart).map(({ id, data = {} }) => [
    String(id),
    String(data.source || ''),
    (data.groups || []).map(g => normalizeGroup(g, data.source || 'app'))
  ]);

  const encodeStatus = ({ id, data = {} }) => [
    String(id),
    String(data.date || String(id).slice(0, 10)),
    String(data.profileId || ''),
    String(data.status || ''),
    data.time == null ? null : String(data.time)
  ];

  const availability = archiveOnly(availabilityDocs, liveStart).map(encodeStatus);
  const legacyStatus = archiveOnly(legacyStatusDocs, liveStart).map(encodeStatus);
  const plans = archiveOnly(plansDocs, liveStart).map(({ id, data = {} }) => [
    String(id),
    String(data.date || id),
    (data.groups || []).map(g => normalizeGroup(g, 'app'))
  ]);

  return {
    schema: QUOTA_BASELINE_SCHEMA,
    liveStart,
    generation,
    generatedAtMs,
    tripDays,
    availability,
    legacyStatus,
    plans,
    counts: {
      tripDays: tripDays.length,
      availability: availability.length,
      legacyStatus: legacyStatus.length,
      plans: plans.length
    }
  };
}

export function splitBaselineParts(baseline) {
  if (!isValidBaseline(baseline, baseline?.liveStart)) throw new Error('Baseline invalide.');
  const shared = {
    schema: baseline.schema,
    liveStart: baseline.liveStart,
    generation: baseline.generation,
    generatedAtMs: baseline.generatedAtMs
  };
  return {
    meta: { ...shared, counts: { ...baseline.counts } },
    trips: { ...shared, rows: baseline.tripDays },
    availability: { ...shared, rows: baseline.availability },
    legacyStatus: { ...shared, rows: baseline.legacyStatus },
    plans: { ...shared, rows: baseline.plans }
  };
}

export function combineBaselineParts(parts, expectedLiveStart = HISTORY_LIVE_START) {
  const required = ['meta', 'trips', 'availability', 'legacyStatus', 'plans'];
  for (const name of required) {
    const p = parts?.[name];
    if (!p || p.schema !== QUOTA_BASELINE_SCHEMA || p.liveStart !== expectedLiveStart || !p.generation) {
      throw new Error(`Partie de baseline invalide : ${name}`);
    }
  }
  const generation = parts.meta.generation;
  for (const name of required) {
    if (parts[name].generation !== generation) throw new Error(`Génération incohérente : ${name}`);
  }
  return {
    schema: QUOTA_BASELINE_SCHEMA,
    liveStart: expectedLiveStart,
    generation,
    generatedAtMs: Number(parts.meta.generatedAtMs || 0),
    counts: { ...(parts.meta.counts || {}) },
    tripDays: parts.trips.rows || [],
    availability: parts.availability.rows || [],
    legacyStatus: parts.legacyStatus.rows || [],
    plans: parts.plans.rows || []
  };
}

export function isValidBaseline(baseline, expectedLiveStart = HISTORY_LIVE_START) {
  return !!baseline
    && baseline.schema === QUOTA_BASELINE_SCHEMA
    && baseline.liveStart === expectedLiveStart
    && typeof baseline.generation === 'string'
    && Array.isArray(baseline.tripDays)
    && Array.isArray(baseline.availability)
    && Array.isArray(baseline.legacyStatus)
    && Array.isArray(baseline.plans);
}

export function selectFreshBaseline(local, server, dirtyAtMs = 0, expectedLiveStart = HISTORY_LIVE_START) {
  const candidates = [local, server].filter(b => isValidBaseline(b, expectedLiveStart));
  const freshest = candidates.sort((a,b) => Number(b.generatedAtMs || 0) - Number(a.generatedAtMs || 0))[0] || null;
  return freshest && Number(freshest.generatedAtMs || 0) >= Number(dirtyAtMs || 0) ? freshest : null;
}

function clearArchiveRange(map, liveStart) {
  for (const key of [...map.keys()]) if (String(key) < liveStart) map.delete(key);
}

function clearLiveRange(map, liveStart) {
  for (const key of [...map.keys()]) if (String(key) >= liveStart) map.delete(key);
}

export function applyArchiveBaseline(baseline, maps) {
  if (!isValidBaseline(baseline, baseline?.liveStart)) throw new Error('Baseline invalide.');
  const { liveStart } = baseline;
  const { tripDays, availability, legacyStatus, plans } = maps;
  [tripDays, availability, legacyStatus, plans].forEach(map => clearArchiveRange(map, liveStart));

  for (const row of baseline.tripDays) {
    const [id, source, groups] = row;
    tripDays.set(id, { date: id, source: source || 'app', groups: (groups || []).map(decodeGroup) });
  }
  for (const row of baseline.availability) {
    const [id, date, profileId, status, time] = row;
    availability.set(id, { date, profileId, status, time });
  }
  for (const row of baseline.legacyStatus) {
    const [id, date, profileId, status, time] = row;
    legacyStatus.set(id, { date, profileId, status, time });
  }
  for (const row of baseline.plans) {
    const [id, date, groups] = row;
    plans.set(id, { date, groups: (groups || []).map(decodeGroup).map(g => ({ id: g.id, members: g.members, driver: g.driver })) });
  }
  return maps;
}

export function replaceLiveEntries(map, entries, liveStart = HISTORY_LIVE_START) {
  clearLiveRange(map, liveStart);
  for (const [id, data] of entries || []) {
    if (String(id) >= liveStart) map.set(String(id), data);
  }
  return map;
}

export function encodedBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
