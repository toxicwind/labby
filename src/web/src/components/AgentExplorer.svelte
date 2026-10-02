<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import {
    fetchAgent,
    fetchAgents,
    fetchMeta,
    fetchStats,
    fetchTimeline,
    fmtTime,
    refreshAgents,
    shortId,
    statusColor,
    type AgentDetail,
    type AgentFilters,
    type AgentListResult,
    type AgentMeta,
    type AgentStats,
    type TimelineBucket,
  } from '$lib/agents';

  let stats = $state<AgentStats | null>(null);
  let timeline = $state<TimelineBucket[]>([]);
  let meta = $state<AgentMeta | null>(null);
  let list = $state<AgentListResult | null>(null);
  let loading = $state(true);
  let tableLoading = $state(false);
  let error = $state<string | null>(null);
  let refreshing = $state(false);

  let filters = $state<AgentFilters>({});
  let page = $state(1);
  let pageSize = $state(50);
  let sort = $state<'newest' | 'oldest'>('newest');
  let detail = $state<AgentDetail | null>(null);
  let detailOpen = $state(false);

  // Debounced search
  let searchInput = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  function onSearchInput() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.search = searchInput.trim() || undefined;
      page = 1;
      void loadTable();
    }, 300);
  }

  async function loadAll() {
    loading = true;
    error = null;
    try {
      const [s, t, m] = await Promise.all([fetchStats(), fetchTimeline(), fetchMeta()]);
      stats = s;
      timeline = t;
      meta = m;
      await loadTable();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load agent data';
    } finally {
      loading = false;
    }
  }

  async function loadTable() {
    tableLoading = true;
    try {
      list = await fetchAgents(filters, page, pageSize, sort);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load agents';
    } finally {
      tableLoading = false;
    }
  }

  function setFilter(key: keyof AgentFilters, value: string) {
    if (!value) {
      const { [key]: _omit, ...rest } = filters;
      filters = rest;
    } else {
      filters = { ...filters, [key]: value };
    }
    page = 1;
    void loadTable();
  }

  async function openDetail(id: string) {
    try {
      detail = await fetchAgent(id);
      detailOpen = true;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load agent detail';
    }
  }

  async function doRefresh() {
    refreshing = true;
    try {
      const r = await refreshAgents();
      // Re-pull stats + timeline + table after the snapshot reloads.
      await loadAll();
      void r;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Refresh failed';
    } finally {
      refreshing = false;
    }
  }

  const totalPages = $derived(list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1);
  const maxTimeline = $derived(timeline.reduce((m, b) => Math.max(m, b.count), 0));

  function barHeight(count: number): number {
    return maxTimeline > 0 ? Math.max(4, Math.round((count / maxTimeline) * 88)) : 4;
  }

  onMount(() => {
    void loadAll();
  });
</script>

<div class="explorer">
  <!-- Stats cards -->
  <section class="card">
    <div class="chead">
      <span class="ti">
        <span class="ibox"><Icon icon="lucide:bot" fallback="bot" size={17} /></span>
        Agent executions
      </span>
      <span class="meta">
        {#if stats?.firstSeen}
          {new Date((stats.firstSeen ?? 0) * 1000).toLocaleDateString()} → {new Date(
            (stats.lastSeen ?? 0) * 1000,
          ).toLocaleDateString()}
        {/if}
      </span>
      <button class="refresh-btn" onclick={doRefresh} disabled={refreshing} title="Reload parquet snapshot">
        <Icon icon="lucide:refresh-cw" fallback="refresh-cw" size={15} />
        {refreshing ? '…' : 'Refresh'}
      </button>
    </div>
    {#if loading && !stats}
      <div class="skeleton" style="height:64px"></div>
    {:else if stats}
      <div class="stat-grid">
        <div class="stat"><span class="num">{stats.total.toLocaleString()}</span><span class="lbl">total</span></div>
        {#each Object.entries(stats.byStatus).sort((a, b) => b[1] - a[1]) as [st, n]}
          <div class="stat">
            <span class="num"><span class="dot {statusColor(st)}"></span>{n.toLocaleString()}</span>
            <span class="lbl">{st}</span>
          </div>
        {/each}
      </div>
      <div class="stat-grid sub">
        {#each Object.entries(stats.byKind).sort((a, b) => b[1] - a[1]) as [k, n]}
          <div class="stat"><span class="num sm">{n.toLocaleString()}</span><span class="lbl">{k}</span></div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Timeline -->
  <section class="card">
    <div class="chead">
      <span class="ti">
        <span class="ibox"><Icon icon="lucide:chart-column" fallback="activity" size={17} /></span>
        Activity timeline
      </span>
      <span class="meta">executions per day</span>
    </div>
    {#if timeline.length === 0}
      <p class="state-msg">No timeline data</p>
    {:else}
      <div class="timeline" role="img" aria-label="Agent executions per day">
        {#each timeline as b}
          <div class="tbar" title="{b.day}: {b.count.toLocaleString()}">
            <div class="tfill" style="height:{barHeight(b.count)}px"></div>
            <span class="tday">{b.day.slice(5)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Models breakdown -->
  {#if stats}
    <section class="card">
      <div class="chead">
        <span class="ti">
          <span class="ibox"><Icon icon="lucide:cpu" fallback="cpu" size={17} /></span>
          Models & types
        </span>
      </div>
      <div class="breakdown">
        <div class="bcol">
          <h4>Model</h4>
          {#each Object.entries(stats.byModel).sort((a, b) => b[1] - a[1]) as [m, n]}
            <button class="brow" onclick={() => setFilter('model', m)} class:active={filters.model === m}>
              <span class="bname">{m}</span><span class="bnum">{n.toLocaleString()}</span>
            </button>
          {/each}
        </div>
        <div class="bcol">
          <h4>Agent type</h4>
          {#each Object.entries(stats.byType).sort((a, b) => b[1] - a[1]) as [t, n]}
            <button
              class="brow"
              onclick={() => setFilter('agent_type', t)}
              class:active={filters.agent_type === t}
            >
              <span class="bname">{t === '__null__' ? '(no type)' : t}</span>
              <span class="bnum">{n.toLocaleString()}</span>
            </button>
          {/each}
        </div>
      </div>
    </section>
  {/if}

  <!-- Table -->
  <section class="card">
    <div class="chead">
      <span class="ti">
        <span class="ibox"><Icon icon="lucide:table" fallback="table" size={17} /></span>
        Executions
      </span>
      {#if list}
        <span class="meta">{list.total.toLocaleString()} matching · page {list.page}/{totalPages}</span>
      {/if}
    </div>

    <div class="filterbar">
      <input
        class="search"
        type="search"
        placeholder="Search agent id…"
        bind:value={searchInput}
        oninput={onSearchInput}
        aria-label="Search agent id"
      />
      <select onchange={(e) => setFilter('status', (e.target as HTMLSelectElement).value)} aria-label="Status filter">
        <option value="">All statuses</option>
        {#each meta?.statuses ?? [] as s}<option value={s} selected={filters.status === s}>{s}</option>{/each}
      </select>
      <select onchange={(e) => setFilter('kind', (e.target as HTMLSelectElement).value)} aria-label="Kind filter">
        <option value="">All kinds</option>
        {#each meta?.kinds ?? [] as k}<option value={k} selected={filters.kind === k}>{k}</option>{/each}
      </select>
      <select onchange={(e) => setFilter('agent_type', (e.target as HTMLSelectElement).value)} aria-label="Type filter">
        <option value="">All types</option>
        {#if meta?.hasNullType}<option value="__null__" selected={filters.agent_type === '__null__'}>(no type)</option>{/if}
        {#each meta?.agentTypes ?? [] as t}<option value={t} selected={filters.agent_type === t}>{t}</option>{/each}
      </select>
      <select onchange={(e) => setFilter('model', (e.target as HTMLSelectElement).value)} aria-label="Model filter">
        <option value="">All models</option>
        {#each meta?.models ?? [] as m}<option value={m} selected={filters.model === m}>{m}</option>{/each}
      </select>
      <select
        onchange={(e) => { sort = (e.target as HTMLSelectElement).value as 'newest' | 'oldest'; page = 1; void loadTable(); }}
        aria-label="Sort order"
      >
        <option value="newest" selected={sort === 'newest'}>Newest first</option>
        <option value="oldest" selected={sort === 'oldest'}>Oldest first</option>
      </select>
      {#if Object.keys(filters).length > 0}
        <button
          class="clear"
          onclick={() => { filters = {}; searchInput = ''; page = 1; void loadTable(); }}
        >
          Clear
        </button>
      {/if}
    </div>

    {#if error}
      <p class="state-msg error" role="alert">{error}</p>
    {:else if tableLoading && !list}
      <div class="skeleton" style="height:200px"></div>
    {:else if list && list.rows.length === 0}
      <p class="state-msg">No agents match these filters</p>
    {:else if list}
      <div class="tablewrap" class:loading={tableLoading}>
        <table>
          <thead>
            <tr>
              <th>Status</th><th>Agent</th><th>Model</th><th>Type</th><th>Kind</th><th>Depth</th><th>Created</th>
            </tr>
          </thead>
          <tbody>
            {#each list.rows as r (r.agent_id)}
              <tr onclick={() => openDetail(r.agent_id)} tabindex="0" onkeydown={(e) => e.key === 'Enter' && openDetail(r.agent_id)}>
                <td><span class="dot {statusColor(r.status)}" title={r.status}></span><span class="sr-only">{r.status}</span></td>
                <td class="mono" title={r.agent_id}>{shortId(r.agent_id)}</td>
                <td class="mono dim">{r.model}</td>
                <td>{r.agent_type ?? '—'}</td>
                <td>{r.kind}</td>
                <td class="num">{r.depth}</td>
                <td class="dim">{fmtTime(r.created_at)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="pager">
        <button disabled={page <= 1} onclick={() => { page -= 1; void loadTable(); }}>← Prev</button>
        <span>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onclick={() => { page += 1; void loadTable(); }}>Next →</button>
        <select
          onchange={(e) => { pageSize = Number((e.target as HTMLSelectElement).value); page = 1; void loadTable(); }}
          aria-label="Page size"
        >
          {#each [25, 50, 100, 200] as n}<option value={n} selected={pageSize === n}>{n}/page</option>{/each}
        </select>
      </div>
    {/if}
  </section>
</div>

{#if detailOpen && detail}
  <Modal title="Agent detail" onclose={() => (detailOpen = false)}>
    <div class="detail">
      <h3 class="mono">{detail.agent.agent_id}</h3>
      <dl>
        <div><dt>Status</dt><dd><span class="dot {statusColor(detail.agent.status)}"></span> {detail.agent.status}</dd></div>
        <div><dt>Model</dt><dd class="mono">{detail.agent.model}</dd></div>
        <div><dt>Type</dt><dd>{detail.agent.agent_type ?? '—'}</dd></div>
        <div><dt>Kind</dt><dd>{detail.agent.kind}</dd></div>
        <div><dt>Depth</dt><dd>{detail.agent.depth}</dd></div>
        <div><dt>Ephemeral</dt><dd>{detail.agent.ephemeral ? 'yes' : 'no'}</dd></div>
        <div><dt>Created</dt><dd>{fmtTime(detail.agent.created_at)}</dd></div>
        <div><dt>Updated</dt><dd>{fmtTime(detail.agent.updated_at)}</dd></div>
        <div><dt>Parent</dt><dd class="mono">{detail.agent.parent_agent_id ?? '—'}</dd></div>
      </dl>
      {#if detail.children.length > 0}
        <h4>Children ({detail.children.length})</h4>
        <ul class="children">
          {#each detail.children as c (c.agent_id)}
            <li>
              <button class="linklike mono" onclick={() => openDetail(c.agent_id)}>{shortId(c.agent_id)}</button>
              <span class="dot {statusColor(c.status)}" title={c.status}></span>
              <span class="dim">{c.kind}{c.agent_type ? ` · ${c.agent_type}` : ''}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </Modal>
{/if}

<style>
  .explorer { display: flex; flex-direction: column; gap: 16px; }
  .stat-grid { display: flex; flex-wrap: wrap; gap: 12px; padding: 4px 2px 8px; }
  .stat-grid.sub { border-top: 1px solid var(--surface-2); padding-top: 12px; }
  .stat { display: flex; flex-direction: column; min-width: 90px; }
  .stat .num { font-size: 1.5rem; font-weight: 700; display: flex; align-items: center; gap: 8px; }
  .stat .num.sm { font-size: 1.1rem; }
  .stat .lbl { font-size: 0.8rem; color: var(--ink-dim); }
  .refresh-btn {
    display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid var(--surface-2); background: var(--surface);
    color: var(--ink); border-radius: var(--pill); padding: 4px 12px;
    font-size: 0.85rem; cursor: pointer; margin-left: auto;
  }
  .refresh-btn:disabled { opacity: 0.5; cursor: default; }
  .timeline { display: flex; align-items: flex-end; gap: 4px; padding: 8px 2px 2px; overflow-x: auto; }
  .tbar { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 34px; flex: 1; }
  .tfill { width: 100%; max-width: 44px; background: var(--accent); border-radius: 4px 4px 0 0; opacity: 0.85; }
  .tday { font-size: 0.7rem; color: var(--ink-faint); }
  .breakdown { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; padding: 4px 2px; }
  .bcol h4 { margin: 0 0 8px; font-size: 0.85rem; color: var(--ink-dim); text-transform: uppercase; letter-spacing: 0.04em; }
  .brow {
    display: flex; justify-content: space-between; align-items: center; width: 100%;
    background: none; border: none; color: var(--ink); padding: 6px 8px; border-radius: var(--radius-sm);
    cursor: pointer; font-size: 0.9rem; text-align: left;
  }
  .brow:hover { background: var(--surface); }
  .brow.active { background: var(--accent-soft); }
  .brow .bname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .brow .bnum { color: var(--ink-dim); font-variant-numeric: tabular-nums; margin-left: 12px; }
  .filterbar { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 2px 12px; }
  .filterbar .search, .filterbar select {
    background: var(--surface); border: 1px solid var(--surface-2); color: var(--ink);
    border-radius: var(--radius-sm); padding: 6px 10px; font-size: 0.9rem;
  }
  .filterbar .search { min-width: 200px; flex: 1; }
  .filterbar .clear {
    background: none; border: 1px solid var(--surface-2); color: var(--ink-dim);
    border-radius: var(--pill); padding: 6px 14px; cursor: pointer; font-size: 0.85rem;
  }
  .tablewrap { overflow-x: auto; }
  .tablewrap.loading { opacity: 0.55; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th { text-align: left; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em;
       color: var(--ink-dim); padding: 8px 10px; border-bottom: 1px solid var(--surface-2); }
  td { padding: 7px 10px; border-bottom: 1px solid var(--surface); }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--surface); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
  .dim { color: var(--ink-dim); }
  .num { font-variant-numeric: tabular-nums; }
  .pager { display: flex; align-items: center; gap: 12px; padding: 12px 2px 4px; font-size: 0.9rem; }
  .pager button {
    background: var(--surface); border: 1px solid var(--surface-2); color: var(--ink);
    border-radius: var(--pill); padding: 5px 14px; cursor: pointer;
  }
  .pager button:disabled { opacity: 0.4; cursor: default; }
  .pager select { background: var(--surface); border: 1px solid var(--surface-2); color: var(--ink);
    border-radius: var(--radius-sm); padding: 5px 8px; margin-left: auto; }
  .detail h3 { font-size: 0.95rem; word-break: break-all; margin: 0 0 12px; }
  .detail dl { display: grid; gap: 6px; margin: 0 0 12px; }
  .detail dl > div { display: grid; grid-template-columns: 90px 1fr; gap: 8px; font-size: 0.9rem; }
  .detail dt { color: var(--ink-dim); }
  .detail dd { margin: 0; display: flex; align-items: center; gap: 6px; }
  .detail h4 { margin: 12px 0 6px; font-size: 0.9rem; }
  .children { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .children li { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; }
  .linklike { background: none; border: none; color: var(--accent-ink); cursor: pointer; padding: 0; font-size: inherit; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .dot.ok { background: var(--ok); } .dot.warn { background: var(--warn); }
  .dot.down { background: var(--down); } .dot.idle { background: var(--idle); }
</style>
