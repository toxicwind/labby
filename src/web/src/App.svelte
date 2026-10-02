<script lang="ts">
  import AgentExplorer from './components/AgentExplorer.svelte';
  import type { Dashboard } from '$lib/types';

  let { config }: { config: Dashboard } = $props();
  const title = $derived(config.title ?? 'Labby');
</script>

<header class="xhead">
  <h1>{title} <span class="sub">· agent explorer</span></h1>
  <a class="settings-link" href="#settings">Settings</a>
</header>

<main class="page">
  <AgentExplorer />
</main>

<style>
  .xhead {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px;
  }
  .xhead h1 { font-size: 1.25rem; margin: 0; }
  .xhead .sub { color: var(--ink-dim); font-weight: 400; font-size: 1rem; }
  .settings-link {
    color: var(--ink-dim); text-decoration: none; font-size: 0.9rem;
    border: 1px solid var(--surface-2); border-radius: var(--pill); padding: 5px 14px;
  }
  .settings-link:hover { color: var(--ink); background: var(--surface); }
  .page { padding: 0 20px 40px; max-width: 1200px; margin: 0 auto; }
</style>
