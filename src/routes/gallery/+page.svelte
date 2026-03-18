<script lang="ts">
	import * as store from '$lib/store.svelte';
	import ClipCard from '$lib/components/ClipCard.svelte';
	import TagFilter from '$lib/components/TagFilter.svelte';

	let allClips = $derived(store.getClips());
	let selectedTags = $state<string[]>([]);
	let searchQuery = $state('');
	let filterDance = $state('');
	let filterStyle = $state('');
	let filterMastery = $state('');
	let filterType = $state('');

	let allTags = $derived(() => {
		const tags = new Set<string>();
		for (const clip of allClips) {
			for (const tag of clip.tags) {
				tags.add(tag);
			}
		}
		return [...tags].sort();
	});

	let allStyles = $derived(() => {
		const s = new Set<string>();
		for (const clip of allClips) { if (clip.style) s.add(clip.style); }
		return [...s].sort();
	});

	let allTypes = $derived(() => {
		const t = new Set<string>();
		for (const clip of allClips) { if (clip.clipType) t.add(clip.clipType); }
		return [...t].sort();
	});

	let hasFilters = $derived(selectedTags.length > 0 || searchQuery || filterDance || filterStyle || filterMastery || filterType);

	let filteredClips = $derived(() => {
		let result = allClips;

		if (filterDance) {
			result = result.filter(c => c.dance === filterDance);
		}
		if (filterStyle) {
			result = result.filter(c => c.style === filterStyle);
		}
		if (filterMastery) {
			result = result.filter(c => c.mastery === filterMastery);
		}
		if (filterType) {
			result = result.filter(c => c.clipType === filterType);
		}

		if (selectedTags.length > 0) {
			result = result.filter((clip) =>
				selectedTags.every((tag) => clip.tags.includes(tag))
			);
		}

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(
				(clip) =>
					clip.label.toLowerCase().includes(q) ||
					clip.videoName.toLowerCase().includes(q) ||
					(clip.lead || '').toLowerCase().includes(q) ||
					(clip.follow || '').toLowerCase().includes(q) ||
					clip.tags.some((t) => t.includes(q))
			);
		}

		return result;
	});

	function clearAll() {
		selectedTags = [];
		searchQuery = '';
		filterDance = '';
		filterStyle = '';
		filterMastery = '';
		filterType = '';
	}
</script>

<div class="page">
	<div class="header">
		<h1>Gallery</h1>
		{#if allClips.length > 0}
			<span class="count">{allClips.length} clip{allClips.length === 1 ? '' : 's'}</span>
		{/if}
	</div>

	{#if allClips.length === 0}
		<div class="empty-state">
			<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-icon">
				<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
				<line x1="7" y1="2" x2="7" y2="22" />
				<line x1="17" y1="2" x2="17" y2="22" />
				<line x1="2" y1="12" x2="22" y2="12" />
				<line x1="2" y1="7" x2="7" y2="7" />
				<line x1="2" y1="17" x2="7" y2="17" />
				<line x1="17" y1="7" x2="22" y2="7" />
				<line x1="17" y1="17" x2="22" y2="17" />
			</svg>
			<p>No clips yet</p>
			<p class="empty-sub">Import a video and start marking your favorite moments</p>
		</div>
	{:else}
		<TagFilter
			allTags={allTags()}
			bind:selectedTags
			bind:searchQuery
		/>

		<div class="filter-dropdowns">
			<select bind:value={filterDance} class="filter-select">
				<option value="">All dances</option>
				<option value="bachata">Bachata</option>
				<option value="salsa">Salsa</option>
			</select>
			{#if allStyles().length > 0}
				<select bind:value={filterStyle} class="filter-select">
					<option value="">All styles</option>
					{#each allStyles() as s}
						<option value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
					{/each}
				</select>
			{/if}
			<select bind:value={filterMastery} class="filter-select">
				<option value="">All mastery</option>
				<option value="seen">Seen it</option>
				<option value="learning">Learning</option>
				<option value="can do">Can do</option>
				<option value="comfortable">Comfortable</option>
				<option value="mastered">Mastered</option>
			</select>
			{#if allTypes().length > 0}
				<select bind:value={filterType} class="filter-select">
					<option value="">All types</option>
					{#each allTypes() as t}
						<option value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
					{/each}
				</select>
			{/if}
			{#if hasFilters}
				<button class="clear-all" onclick={clearAll}>Clear all</button>
			{/if}
		</div>

		<div class="results-info">
			{#if hasFilters}
				<span>{filteredClips().length} result{filteredClips().length === 1 ? '' : 's'}</span>
			{/if}
		</div>

		<div class="clip-grid">
			{#each filteredClips() as clip (clip.id)}
				<ClipCard {clip} />
			{/each}
		</div>

		{#if filteredClips().length === 0 && hasFilters}
			<div class="no-results">
				<p>No clips match your filters</p>
			</div>
		{/if}
	{/if}
</div>

<style>
	.page {
		max-width: 1100px;
		margin: 0 auto;
	}

	.header {
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 24px;
	}

	h1 {
		font-size: 22px;
		font-weight: 600;
		margin: 0;
		letter-spacing: -0.02em;
	}

	.count {
		font-size: 13px;
		color: #52525b;
		font-weight: 500;
	}

	.filter-dropdowns {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		margin-top: 10px;
	}

	.filter-select {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #a1a1aa;
		padding: 7px 32px 7px 10px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		font-family: 'Inter', sans-serif;
		cursor: pointer;
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%2352525b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 10px center;
		transition: border-color 0.15s;
	}

	.filter-select:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
	}

	.filter-select option {
		background: #18181b;
		color: #e4e4e7;
	}

	.clear-all {
		background: none;
		border: none;
		color: #52525b;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		padding: 4px 0;
		transition: color 0.15s;
	}

	.clear-all:hover {
		color: #a1a1aa;
	}

	.results-info {
		min-height: 24px;
		margin: 12px 0 4px;
	}

	.results-info span {
		font-size: 12px;
		color: #52525b;
		font-weight: 500;
	}

	.clip-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
		gap: 16px;
	}

	.empty-state {
		text-align: center;
		padding: 80px 20px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.empty-icon {
		color: #27272a;
		margin-bottom: 8px;
	}

	.empty-state p {
		color: #52525b;
		margin: 0;
		font-size: 15px;
		font-weight: 500;
	}

	.empty-sub {
		font-size: 13px !important;
		font-weight: 400 !important;
		color: #3f3f46 !important;
	}

	.no-results {
		text-align: center;
		padding: 48px 20px;
	}

	.no-results p {
		color: #3f3f46;
		font-size: 14px;
	}

	@media (max-width: 640px) {
		.clip-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
