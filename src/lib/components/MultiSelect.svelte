<script lang="ts">
	let {
		label = '',
		selected = $bindable<string[]>([]),
		options = [],
		placeholder = 'Search...',
		disabled = false
	}: {
		label?: string;
		selected?: string[];
		options?: string[];
		placeholder?: string;
		disabled?: boolean;
	} = $props();

	let open = $state(false);
	let search = $state('');
	let containerEl: HTMLElement | undefined = $state();
	let inputEl: HTMLInputElement | undefined = $state();

	let filtered = $derived(() => {
		const q = search.toLowerCase();
		return options
			.filter(o => !selected.includes(o))
			.filter(o => !q || o.toLowerCase().includes(q));
	});

	function add(val: string) {
		selected = [...selected, val];
		search = '';
		inputEl?.focus();
	}

	function remove(val: string) {
		selected = selected.filter(s => s !== val);
	}

	function handleInputFocus() {
		if (!disabled) open = true;
	}

	function handleInputKeydown(e: KeyboardEvent) {
		if (e.key === 'Backspace' && !search && selected.length > 0) {
			selected = selected.slice(0, -1);
		}
		if (e.key === 'Enter' && search.trim()) {
			e.preventDefault();
			const match = filtered().find(o => o.toLowerCase() === search.toLowerCase());
			if (match) {
				add(match);
			} else if (search.trim()) {
				add(search.trim().toLowerCase());
			}
		}
		if (e.key === 'Escape') {
			open = false;
			search = '';
		}
	}

	function handleClickOutside(e: MouseEvent) {
		if (containerEl && !containerEl.contains(e.target as Node)) {
			open = false;
			search = '';
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="multiselect" bind:this={containerEl} class:disabled>
	{#if label}
		<span class="ms-label">{label}</span>
	{/if}
	<div class="ms-control" class:open onclick={() => inputEl?.focus()}>
		<div class="ms-chips">
			{#each selected as tag}
				<span class="ms-chip">
					{tag}
					<button type="button" class="ms-chip-remove" onclick={() => remove(tag)}>
						<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
					</button>
				</span>
			{/each}
			<input
				bind:this={inputEl}
				type="text"
				class="ms-input"
				bind:value={search}
				onfocus={handleInputFocus}
				onkeydown={handleInputKeydown}
				placeholder={selected.length === 0 ? placeholder : ''}
				{disabled}
			/>
		</div>
	</div>
	{#if open && filtered().length > 0}
		<div class="ms-menu">
			{#each filtered() as opt}
				<button
					type="button"
					class="ms-item"
					onclick={() => add(opt)}
				>
					{opt}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.multiselect {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.multiselect.disabled {
		opacity: 0.5;
		pointer-events: none;
	}

	.ms-label {
		font-size: 10px;
		text-transform: uppercase;
		color: #52525b;
		font-weight: 600;
		letter-spacing: 0.06em;
	}

	.ms-control {
		display: flex;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		padding: 6px 8px;
		min-height: 42px;
		cursor: text;
		transition: border-color 0.15s;
	}

	.ms-control:hover {
		border-color: rgba(255, 255, 255, 0.1);
	}

	.ms-control.open {
		border-color: rgba(99, 102, 241, 0.4);
	}

	.ms-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: center;
		flex: 1;
	}

	.ms-chip {
		display: flex;
		align-items: center;
		gap: 4px;
		background: rgba(99, 102, 241, 0.1);
		color: #818cf8;
		padding: 3px 6px 3px 8px;
		border-radius: 5px;
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
	}

	.ms-chip-remove {
		display: flex;
		background: none;
		border: none;
		color: #6366f1;
		cursor: pointer;
		padding: 1px;
		border-radius: 3px;
		transition: color 0.15s;
	}

	.ms-chip-remove:hover {
		color: #ef4444;
	}

	.ms-input {
		flex: 1;
		min-width: 80px;
		background: none;
		border: none;
		color: #e4e4e7;
		font-size: 13px;
		font-family: 'Inter', sans-serif;
		outline: none;
		padding: 2px 4px;
	}

	.ms-input::placeholder {
		color: #3f3f46;
	}

	.ms-menu {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		margin-top: 4px;
		background: #1c1c20;
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		padding: 4px;
		z-index: 100;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		max-height: 200px;
		overflow-y: auto;
	}

	.ms-item {
		display: block;
		width: 100%;
		background: none;
		border: none;
		color: #a1a1aa;
		padding: 7px 10px;
		border-radius: 5px;
		font-size: 13px;
		font-family: 'Inter', sans-serif;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s, color 0.1s;
	}

	.ms-item:hover {
		background: rgba(255, 255, 255, 0.06);
		color: #e4e4e7;
	}
</style>
