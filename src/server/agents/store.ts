/**
 * Agent data store — reads the agent execution ledger from a parquet snapshot
 * and serves it to the API layer.
 *
 * The parquet file is produced by the export pipeline (see scripts/export-agents.ts):
 * one row per agent execution from the Hatch `agent.agents` table. The store
 * loads it fully into memory on boot (18k rows is trivial) and re-reads it on
 * demand via POST /api/agents/refresh.
 *
 * Parquet is the estate's forward convention for tabular data ("all txt should
 * be parquet forward" — Chris 2026-10-02). Reader: hyparquet (pure JS, zero
 * deps). Writer (pipeline side): hyparquet-writer.
 */

import { parquetReadObjects } from 'hyparquet';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type AgentRecord = {
  agent_id: string;
  model: string;
  agent_type: string | null;
  kind: string;
  status: string;
  depth: number;
  ephemeral: boolean;
  created_at: number; // unix seconds
  updated_at: number; // unix seconds
  parent_agent_id: string | null;
};

export type AgentFilters = {
  model?: string;
  agent_type?: string | null; // '__null__' sentinel for "no type"
  kind?: string;
  status?: string;
  search?: string; // substring match on agent_id
};

export type AgentStats = {
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  byModel: Record<string, number>;
  byType: Record<string, number>; // '__null__' key for untyped
  firstSeen: number | null;
  lastSeen: number | null;
  exportedAt: number | null;
};

export type TimelineBucket = { day: string; count: number };

const PARQUET_PATH =
  process.env.AGENTS_PARQUET_PATH ?? path.join(process.cwd(), 'data', 'agents.parquet');

let rows: AgentRecord[] = [];
let loadedAt: number | null = null;
let loadError: string | null = null;

function num(v: unknown): number {
  if (typeof v === 'bigint') return Number(v);
  return Number(v ?? 0);
}

function coerce(row: Record<string, unknown>): AgentRecord {
  // The pipeline writes null agent_type / parent_agent_id as '' (parquet
  // STRING has no null in the writer's simple path); map it back here.
  const at = row.agent_type == null || row.agent_type === '' ? null : String(row.agent_type);
  const pa = row.parent_agent_id == null || row.parent_agent_id === '' ? null : String(row.parent_agent_id);
  return {
    agent_id: String(row.agent_id ?? ''),
    model: String(row.model ?? ''),
    agent_type: at,
    kind: String(row.kind ?? ''),
    status: String(row.status ?? ''),
    depth: num(row.depth),
    ephemeral: Boolean(row.ephemeral),
    created_at: num(row.created_at),
    updated_at: num(row.updated_at),
    parent_agent_id: pa,
  };
}

export async function loadAgents(): Promise<{ count: number; error: string | null }> {
  try {
    const buf = await readFile(PARQUET_PATH);
    // hyparquet wants an ArrayBuffer; Buffer's underlying store may be larger
    // than the view, so slice it to the exact byte range.
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const raw = (await parquetReadObjects({ file: ab })) as Record<string, unknown>[];
    rows = raw.map(coerce).filter((r) => r.agent_id.length > 0);
    // Keep chronological order — the export writes ORDER BY created_at, agent_id.
    rows.sort((a, b) => a.created_at - b.created_at || (a.agent_id < b.agent_id ? -1 : 1));
    loadedAt = Date.now();
    loadError = null;
    console.log(`[agents] loaded ${rows.length} records from ${PARQUET_PATH}`);
    return { count: rows.length, error: null };
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    console.error(`[agents] failed to load ${PARQUET_PATH}: ${loadError}`);
    return { count: 0, error: loadError };
  }
}

export function agentStoreStatus() {
  return {
    path: PARQUET_PATH,
    count: rows.length,
    loadedAt,
    error: loadError,
  };
}

export function getAgent(id: string): AgentRecord | null {
  return rows.find((r) => r.agent_id === id) ?? null;
}

export function getChildren(id: string): AgentRecord[] {
  return rows.filter((r) => r.parent_agent_id === id);
}

function matches(r: AgentRecord, f: AgentFilters): boolean {
  if (f.model && r.model !== f.model) return false;
  if (f.kind && r.kind !== f.kind) return false;
  if (f.status && r.status !== f.status) return false;
  if (f.agent_type !== undefined) {
    if (f.agent_type === '__null__') {
      if (r.agent_type !== null) return false;
    } else if (r.agent_type !== f.agent_type) return false;
  }
  if (f.search && !r.agent_id.toLowerCase().includes(f.search.toLowerCase())) return false;
  return true;
}

export type ListResult = {
  total: number;
  page: number;
  pageSize: number;
  rows: AgentRecord[];
};

export function listAgents(
  filters: AgentFilters,
  page: number,
  pageSize: number,
  sort: 'newest' | 'oldest' = 'newest',
): ListResult {
  const filtered = rows.filter((r) => matches(r, filters));
  // rows are stored oldest-first; newest-first is a reversed view.
  const ordered = sort === 'newest' ? [...filtered].reverse() : filtered;
  const total = ordered.length;
  const safePage = Math.max(1, page);
  const safeSize = Math.min(200, Math.max(1, pageSize));
  const start = (safePage - 1) * safeSize;
  return {
    total,
    page: safePage,
    pageSize: safeSize,
    rows: ordered.slice(start, start + safeSize),
  };
}

export function agentStats(): AgentStats {
  const byStatus: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let firstSeen: number | null = null;
  let lastSeen: number | null = null;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    byModel[r.model] = (byModel[r.model] ?? 0) + 1;
    const tkey = r.agent_type ?? '__null__';
    byType[tkey] = (byType[tkey] ?? 0) + 1;
    if (firstSeen === null || r.created_at < firstSeen) firstSeen = r.created_at;
    if (lastSeen === null || r.created_at > lastSeen) lastSeen = r.created_at;
  }
  return { total: rows.length, byStatus, byKind, byModel, byType, firstSeen, lastSeen, exportedAt: loadedAt };
}

export function agentTimeline(): TimelineBucket[] {
  const buckets = new Map<number, number>();
  for (const r of rows) {
    const day = Math.floor(r.created_at / 86400) * 86400;
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([epoch, count]) => ({
      day: new Date(epoch * 1000).toISOString().slice(0, 10),
      count,
    }));
}

export function agentFilterMeta() {
  const models = new Set<string>();
  const types = new Set<string>();
  const kinds = new Set<string>();
  const statuses = new Set<string>();
  let hasNullType = false;
  for (const r of rows) {
    models.add(r.model);
    kinds.add(r.kind);
    statuses.add(r.status);
    if (r.agent_type === null) hasNullType = true;
    else types.add(r.agent_type);
  }
  return {
    models: [...models].sort(),
    agentTypes: [...types].sort(),
    hasNullType,
    kinds: [...kinds].sort(),
    statuses: [...statuses].sort(),
  };
}
