#!/usr/bin/env bun
/**
 * Convert the agent export (JSONL, one agent record per line) into a parquet
 * snapshot for the explorer to serve.
 *
 * Usage:
 *   bun scripts/agents-to-parquet.ts [input.jsonl] [output.parquet]
 *
 * Defaults: data/agents.jsonl -> data/agents.parquet (relative to repo root).
 *
 * Column types are explicit — parquet is typed, so we declare the schema
 * instead of letting the writer guess:
 *   agent_id, model, agent_type, kind, status, parent_agent_id -> STRING
 *   depth, created_at, updated_at                              -> INT64
 *   ephemeral                                                  -> BOOLEAN
 */

import { parquetWriteBuffer } from 'hyparquet-writer';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const inPath = process.argv[2] ?? path.join(root, 'data', 'agents.jsonl');
const outPath = process.argv[3] ?? path.join(root, 'data', 'agents.parquet');

const text = await readFile(inPath, 'utf8');
const lines = text.split('\n').filter((l) => l.trim().length > 0);
console.log(`read ${lines.length} json lines from ${inPath}`);

const cols: Record<string, unknown[]> = {
  agent_id: [],
  model: [],
  agent_type: [],
  kind: [],
  status: [],
  depth: [],
  ephemeral: [],
  created_at: [],
  updated_at: [],
  parent_agent_id: [],
};

for (const line of lines) {
  const r = JSON.parse(line) as Record<string, unknown>;
  cols.agent_id.push(String(r.agent_id ?? ''));
  cols.model.push(String(r.model ?? ''));
  cols.agent_type.push(r.agent_type == null ? '' : String(r.agent_type));
  cols.kind.push(String(r.kind ?? ''));
  cols.status.push(String(r.status ?? ''));
  cols.depth.push(BigInt(Math.trunc(Number(r.depth ?? 0))));
  cols.ephemeral.push(Boolean(r.ephemeral));
  cols.created_at.push(BigInt(Math.trunc(Number(r.created_at ?? 0))));
  cols.updated_at.push(BigInt(Math.trunc(Number(r.updated_at ?? 0))));
  cols.parent_agent_id.push(r.parent_agent_id == null ? '' : String(r.parent_agent_id));
}

// Empty string sentinel for nulls (parquet STRING has no null in this writer's
// simple path); the store maps '' back to null for agent_type/parent_agent_id.
const buf = parquetWriteBuffer({
  columnData: [
    { name: 'agent_id', data: cols.agent_id, type: 'STRING' },
    { name: 'model', data: cols.model, type: 'STRING' },
    { name: 'agent_type', data: cols.agent_type, type: 'STRING' },
    { name: 'kind', data: cols.kind, type: 'STRING' },
    { name: 'status', data: cols.status, type: 'STRING' },
    { name: 'depth', data: cols.depth, type: 'INT64' },
    { name: 'created_at', data: cols.created_at, type: 'INT64' },
    { name: 'updated_at', data: cols.updated_at, type: 'INT64' },
    { name: 'parent_agent_id', data: cols.parent_agent_id, type: 'STRING' },
    { name: 'ephemeral', data: cols.ephemeral, type: 'BOOLEAN' },
  ],
});

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, Buffer.from(buf));
console.log(`wrote ${buf.byteLength} bytes -> ${outPath}`);
