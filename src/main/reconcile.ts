import type { Provider } from '../shared/types';

export interface ReconciliationFact {
  source_key: string;
  provider: Provider;
  session_id: string;
  occurred_at: string;
  owner_user_id: string | null;
}

export interface ReconciliationResult<T> {
  confirmed: T[];
  pending: T[];
  pendingKeys: Set<string>;
  conflictSources: Array<'local' | 'telemetry'>;
}

type Source = 'local' | 'telemetry';
interface Group<T> {
  source: Source;
  provider: Provider;
  session: string | null;
  day: string;
  owner: string | null;
  facts: T[];
  first: number;
  last: number;
}

function knownSession(session: string): string | null {
  const value = session.trim();
  return value && value !== 'unknown' ? value : null;
}

function overlaps<T>(local: Group<T>, telemetry: Group<T>): boolean {
  if (local.owner && telemetry.owner && local.owner !== telemetry.owner) return false;
  if (local.session && telemetry.session) return local.session === telemetry.session;
  return local.first - telemetry.last <= 86_400_000 && telemetry.first - local.last <= 86_400_000;
}

function nearbyDays(day: string): string[] {
  const center = Date.parse(`${day}T00:00:00Z`);
  return [-1, 0, 1].map(offset => new Date(center + offset * 86_400_000).toISOString().slice(0, 10));
}

// All callers pass only facts within the actor's authorized scope. No common local/OTel
// event ID exists today, so a possible overlap remains pending rather than being summed.
export function reconcileFacts<T extends ReconciliationFact>(facts: T[]): ReconciliationResult<T> {
  const groups = new Map<string, Group<T>>();
  for (const fact of facts) {
    const source: Source = fact.source_key.startsWith('otel:') ? 'telemetry' : 'local';
    const session = fact.source_key.startsWith('codex:fallback:') ? null : knownSession(fact.session_id);
    const day = fact.occurred_at.slice(0, 10);
    const occurred = Date.parse(fact.occurred_at);
    const owner = fact.owner_user_id || null;
    const key = JSON.stringify([source, fact.provider, session, day, owner]);
    let group = groups.get(key);
    if (!group) {
      group = { source, provider: fact.provider, session, day, owner, facts: [], first: occurred, last: occurred };
      groups.set(key, group);
    }
    group.facts.push(fact);
    group.first = Math.min(group.first, occurred);
    group.last = Math.max(group.last, occurred);
  }
  const telemetryBySession = new Map<string, Group<T>[]>();
  const telemetryUnknownByDay = new Map<string, Group<T>[]>();
  const telemetryAllByDay = new Map<string, Group<T>[]>();
  const put = (map: Map<string, Group<T>[]>, key: string, group: Group<T>) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(group);
  };
  for (const group of groups.values()) {
    if (group.source !== 'telemetry') continue;
    if (group.session) put(telemetryBySession, `${group.provider}\0${group.session}`, group);
    else put(telemetryUnknownByDay, `${group.provider}\0${group.day}`, group);
    put(telemetryAllByDay, `${group.provider}\0${group.day}`, group);
  }
  const pendingKeys = new Set<string>();
  for (const group of groups.values()) {
    if (group.source !== 'local') continue;
    const candidates = group.session
      ? [...(telemetryBySession.get(`${group.provider}\0${group.session}`) || []),
        ...nearbyDays(group.day).flatMap(day => telemetryUnknownByDay.get(`${group.provider}\0${day}`) || [])]
      : nearbyDays(group.day).flatMap(day => telemetryAllByDay.get(`${group.provider}\0${day}`) || []);
    for (const candidate of candidates) {
      if (!overlaps(group, candidate)) continue;
      for (const fact of group.facts) pendingKeys.add(fact.source_key);
      for (const fact of candidate.facts) pendingKeys.add(fact.source_key);
    }
  }
  const confirmed = facts.filter(fact => !pendingKeys.has(fact.source_key));
  const pending = facts.filter(fact => pendingKeys.has(fact.source_key));
  const conflictSources = (['local', 'telemetry'] as const).filter(source =>
    pending.some(fact => (fact.source_key.startsWith('otel:') ? 'telemetry' : 'local') === source));
  return { confirmed, pending, pendingKeys, conflictSources };
}
