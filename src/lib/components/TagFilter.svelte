<script lang="ts">
	let {
		allTags = [],
		selectedTags = $bindable([]),
		searchQuery = $bindable('')
	}: {
		allTags?: string[];
		selectedTags?: string[];
		searchQuery?: string;
	} = $props();

	function toggleTag(tag: string) {
		if (selectedTags.includes(tag)) {
			selectedTags = selectedTags.filter(t => t !== tag);
		} else {
			selectedTags = [...selectedTags, tag];
		}
	}

	function clearFilters() {
		selectedTags = [];
		searchQuery = '';
	}

	let hasFilters = $derived(selectedTags.length > 0 || searchQuery.length > 0);
</script>

<div class="filter-bar">
	<div class="search-wrapper">
		<svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
		</svg>
		<input
			type="text"
			placeholder="Search clips..."
			bind:value={searchQuery}
		/>
		{#if searchQuery}
			<button class="clear-input" onclick={() => searchQuery = ''}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
			</button>
		{/if}
	</div>

	{#if allTags.length > 0}
		<div class="tags">
			{#each allTags as tag}
				<button
					class="tag"
					class:active={selectedTags.includes(tag)}
					onclick={() => toggleTag(tag)}
				>
					{tag}
				</button>
			{/each}
		</div>
	{/if}

	{#if hasFilters}
		<button class="clear-all" onclick={clearFilters}>Clear filters</button>
	{/if}
</div>

<style>
	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
	}

	.search-wrapper {
		position: relative;
		flex: 1;
		min-width: 200px;
		max-width: 320px;
	}

	.search-icon {
		position: absolute;
		left: 12px;
		top: 50%;
		transform: translateY(-50%);
		color: #3f3f46;
		pointer-events: none;
	}

	input {
		width: 100%;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #e4e4e7;
		padding: 9px 36px 9px 36px;
		border-radius: 8px;
		font-size: 13px;
		font-family: 'Inter', sans-serif;
		transition: border-color 0.15s;
	}

	input::placeholder {
		color: #3f3f46;
	}

	input:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
	}

	.clear-input {
		position: absolute;
		right: 8px;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: #52525b;
		cursor: pointer;
		padding: 2px;
		display: flex;
	}

	.clear-input:hover {
		color: #a1a1aa;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.tag {
		background: rgba(255, 255, 255, 0.03);
		color: #71717a;
		border: 1px solid rgba(255, 255, 255, 0.06);
		padding: 5px 12px;
		border-radius: 16px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.tag:hover {
		background: rgba(255, 255, 255, 0.06);
		color: #a1a1aa;
	}

	.tag.active {
		background: rgba(99, 102, 241, 0.12);
		color: #818cf8;
		border-color: rgba(99, 102, 241, 0.25);
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
</style>
