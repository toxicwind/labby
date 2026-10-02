/**
 * Agent explorer API routes — Hono router mounted at /api/agents.
 *
 * Endpoints:
 *   GET /api/agents              paginated + filtered list
 *   GET /api/agents/stats        aggregate counts
 *   GET /api/agents/timeline     daily buckets
 *   GET /api/agents/meta         distinct filter values
 *   GET /api/agents/status       store health (path, count, loadedAt, error)
 *   GET /api/agents/:id          single record + children
 *   POST /api/agents/refresh     reload the parquet snapshot from disk
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  agentFilterMeta,
  agentStats,
  agentStoreStatus,
  agentTimeline,
  getAgent,
  getChildren,
  listAgents,
  loadAgents,
  type AgentFilters,
} from './store';
import { hub } from '../sse/hub';

const app = new Hono();

const ListQuery = z.object({
  model: z.string().optional(),
  agent_type: z.string().optional(),
  kind: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});

app.get('/', (c) => {
  const parsed = ListQuery.safeParse({
    model: c.req.query('model'),
    agent_type: c.req.query('agent_type'),
    kind: c.req.query('kind'),
    status: c.req.query('status'),
    search: c.req.query('search'),
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
    sort: c.req.query('sort'),
  });
  if (!parsed.success) return c.json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
  const q = parsed.data;
  const filters: AgentFilters = {};
  if (q.model) filters.model = q.model;
  if (q.agent_type) filters.agent_type = q.agent_type;
  if (q.kind) filters.kind = q.kind;
  if (q.status) filters.status = q.status;
  if (q.search) filters.search = q.search;
  return c.json(listAgents(filters, q.page, q.pageSize, q.sort));
});

app.get('/stats', (c) => c.json(agentStats()));
app.get('/timeline', (c) => c.json(agentTimeline()));
app.get('/meta', (c) => c.json(agentFilterMeta()));
app.get('/status', (c) => c.json(agentStoreStatus()));

app.get('/:id', (c) => {
  const agent = getAgent(c.req.param('id'));
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  return c.json({ agent, children: getChildren(agent.agent_id) });
});

app.post('/refresh', async (c) => {
  const result = await loadAgents();
  if (result.error) return c.json({ error: result.error, count: 0 }, 500);
  // Push fresh stats down the SSE stream so the dashboard updates live.
  hub.publish('agents:stats', agentStats() as unknown as Parameters<typeof hub.publish>[1]);
  hub.publish('agents:timeline', agentTimeline() as unknown as Parameters<typeof hub.publish>[1]);
  return c.json({ ok: true, count: result.count });
});

export default app;
