/** Agent explorer API client — talks to /api/agents on the Hono server. */

export type AgentRecord = {
  agent_id: string;
  model: string;
  agent_type: string | null;
  kind: string;
  status: string;
  depth: number;
  ephemeral: boolean;
  created_at: number;
  updated_at: number;
  parent_agent_id: string | null;
};

export type AgentFilters = {
  model?: string;
  agent_type?: string;
  kind?: string;
  status?: string;
  search?: string;
};

export type AgentListResult = {
  total: number;
  page: number;
  pageSize: number;
  rows: AgentRecord[];
};

export type AgentStats = {
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  byModel: Record<string, number>;
  byType: Record<string, number>;
  firstSeen: number | null;
  lastSeen: number | null;
  exportedAt: number | null;
};

export type TimelineBucket = { day: string; count: number };

export type AgentMeta = {
  models: string[];
  agentTypes: string[];
  hasNullType: boolean;
  kinds: string[];
  statuses: string[];
};

export type AgentDetail = {
  agent: AgentRecord;
  children: AgentRecord[];
};

const BASE = '/api/agents';

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchAgents(
  filters: AgentFilters,
  page: number,
  pageSize: number,
  sort: 'newest' | 'oldest' = 'newest',
): Promise<AgentListResult> {
  return get<AgentListResult>(`/${qs({ ...filters, page, pageSize, sort })}`);
}

export const fetchStats = () => get<AgentStats>('/stats');
export const fetchTimeline = () => get<TimelineBucket[]>('/timeline');
export const fetchMeta = () => get<AgentMeta>('/meta');
export const fetchAgent = (id: string) => get<AgentDetail>(`/${encodeURIComponent(id)}`);

export async function refreshAgents(): Promise<{ ok: boolean; count: number }> {
  const res = await fetch(`${BASE}/refresh`, { method: 'POST' });
  if (!res.ok) throw new Error(`refresh: ${res.status}`);
  return res.json();
}

export function fmtTime(epochSec: number | null): string {
  if (epochSec == null || epochSec <= 0) return '—';
  return new Date(epochSec * 1000).toLocaleString();
}

export function fmtDate(epochSec: number | null): string {
  if (epochSec == null || epochSec <= 0) return '—';
  return new Date(epochSec * 1000).toLocaleDateString();
}

export function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function statusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'ok';
    case 'running':
      return 'warn';
    case 'errored':
    case 'interrupted':
      return 'down';
    case 'shutdown':
      return 'idle';
    default:
      return 'idle';
  }
}
