<script lang="ts">
	import * as store from '$lib/store.svelte';
	import { goto } from '$app/navigation';

	let practices = $derived(store.getPractices());
	let allClips = $derived(store.getClips());

	function getClipCount(practice: { clipIds: string[] }) {
		return practice.clipIds.filter(id => allClips.some(c => c.id === id)).length;
	}

	function getTotalDuration(practice: { clipIds: string[] }) {
		let total = 0;
		for (const id of practice.clipIds) {
			const clip = allClips.find(c => c.id === id);
			if (clip) total += clip.endTime - clip.startTime;
		}
		return total;
	}

	function formatDuration(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	async function createSession() {
		const name = prompt('Practice session name:');
		if (!name?.trim()) return;
		const practice = await store.addPractice({ name: name.trim(), clipIds: [] });
		goto(`/practice/${practice.id}`);
	}

	async function deleteSession(id: string, e: Event) {
		e.preventDefault();
		e.stopPropagation();
		if (!confirm('Delete this practice session?')) return;
		await store.deletePractice(id);
	}
</script>

<div class="page">
	<div class="header">
		<h1>Practice Sessions</h1>
		<button class="create-btn" onclick={createSession}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
				<line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
			</svg>
			New Session
		</button>
	</div>

	{#if practices.length === 0}
		<div class="empty">
			<p>No practice sessions yet.</p>
			<p class="hint">Create a session and add clips to build your practice routine.</p>
		</div>
	{:else}
		<div class="grid">
			{#each practices as practice (practice.id)}
				<a href="/practice/{practice.id}" class="session-card">
					<div class="session-info">
						<h3>{practice.name}</h3>
						<div class="session-meta">
							<span>{getClipCount(practice)} clip{getClipCount(practice) === 1 ? '' : 's'}</span>
							<span class="dot"></span>
							<span>{formatDuration(getTotalDuration(practice))}</span>
							{#if practice.loop}
								<span class="dot"></span>
								<span class="loop-badge">Loop</span>
							{/if}
						</div>
					</div>
					<button class="delete-btn" onclick={(e) => deleteSession(practice.id, e)} title="Delete">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
							<polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
						</svg>
					</button>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 720px;
		margin: 0 auto;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 24px;
	}

	h1 {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin: 0;
	}

	.create-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		background: #6366f1;
		color: #fff;
		border: none;
		padding: 9px 16px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: background 0.15s;
	}

	.create-btn:hover {
		background: #7c3aed;
	}

	.empty {
		text-align: center;
		padding: 60px 24px;
		color: #52525b;
	}

	.empty p {
		margin: 0;
		font-size: 15px;
	}

	.hint {
		margin-top: 8px !important;
		font-size: 13px !important;
		color: #3f3f46;
	}

	.grid {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.session-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 10px;
		padding: 16px 18px;
		text-decoration: none;
		color: inherit;
		transition: border-color 0.2s, background 0.2s;
	}

	.session-card:hover {
		border-color: rgba(255, 255, 255, 0.08);
		background: #1c1c20;
	}

	.session-info {
		flex: 1;
		min-width: 0;
	}

	h3 {
		margin: 0 0 4px;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.session-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		color: #52525b;
		font-size: 12px;
		font-weight: 500;
	}

	.dot {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: #3f3f46;
	}

	.loop-badge {
		color: #818cf8;
	}

	.delete-btn {
		background: none;
		border: none;
		color: #3f3f46;
		padding: 8px;
		border-radius: 6px;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
		flex-shrink: 0;
	}

	.delete-btn:hover {
		color: #ef4444;
		background: rgba(239, 68, 68, 0.08);
	}
</style>
