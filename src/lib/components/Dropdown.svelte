<script lang="ts">
	let {
		label = '',
		value = $bindable(''),
		options = [],
		placeholder = 'Select...',
		disabled = false
	}: {
		label?: string;
		value?: string;
		options?: { value: string; label: string }[];
		placeholder?: string;
		disabled?: boolean;
	} = $props();

	let open = $state(false);
	let containerEl: HTMLElement | undefined = $state();

	let displayLabel = $derived(
		options.find(o => o.value === value)?.label || ''
	);

	function toggle() {
		if (!disabled) open = !open;
	}

	function select(val: string) {
		value = val;
		open = false;
	}

	function clear(e: Event) {
		e.stopPropagation();
		value = '';
		open = false;
	}

	function handleClickOutside(e: MouseEvent) {
		if (containerEl && !containerEl.contains(e.target as Node)) {
			open = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<div class="dropdown" bind:this={containerEl} class:disabled>
	{#if label}
		<span class="dropdown-label">{label}</span>
	{/if}
	<button
		type="button"
		class="dropdown-trigger"
		class:open
		class:has-value={value !== ''}
		onclick={toggle}
		{disabled}
	>
		<span class="dropdown-text">{displayLabel || placeholder}</span>
		<div class="dropdown-actions">
			{#if value}
				<span class="dropdown-clear" role="button" tabindex="-1" onclick={clear}>
					<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</span>
			{/if}
			<svg class="dropdown-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none">
				<path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</div>
	</button>
	{#if open}
		<div class="dropdown-menu">
			{#each options as opt}
				<button
					type="button"
					class="dropdown-item"
					class:selected={value === opt.value}
					onclick={() => select(opt.value)}
				>
					{opt.label}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.dropdown {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.dropdown.disabled {
		opacity: 0.5;
		pointer-events: none;
	}

	.dropdown-label {
		font-size: 10px;
		text-transform: uppercase;
		color: #52525b;
		font-weight: 600;
		letter-spacing: 0.06em;
	}

	.dropdown-trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #52525b;
		padding: 10px 12px;
		border-radius: 8px;
		font-size: 13px;
		font-family: 'Inter', sans-serif;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
		text-align: left;
	}

	.dropdown-trigger:hover {
		border-color: rgba(255, 255, 255, 0.1);
		background: rgba(255, 255, 255, 0.04);
	}

	.dropdown-trigger.open {
		border-color: rgba(99, 102, 241, 0.4);
	}

	.dropdown-trigger.has-value {
		color: #e4e4e7;
	}

	.dropdown-text {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dropdown-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.dropdown-clear {
		color: #52525b;
		display: flex;
		padding: 2px;
		border-radius: 3px;
		cursor: pointer;
		transition: color 0.15s;
	}

	.dropdown-clear:hover {
		color: #ef4444;
	}

	.dropdown-chevron {
		color: #3f3f46;
		transition: transform 0.15s;
	}

	.dropdown-trigger.open .dropdown-chevron {
		transform: rotate(180deg);
	}

	.dropdown-menu {
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

	.dropdown-item {
		display: block;
		width: 100%;
		background: none;
		border: none;
		color: #a1a1aa;
		padding: 8px 10px;
		border-radius: 5px;
		font-size: 13px;
		font-family: 'Inter', sans-serif;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s, color 0.1s;
	}

	.dropdown-item:hover {
		background: rgba(255, 255, 255, 0.06);
		color: #e4e4e7;
	}

	.dropdown-item.selected {
		color: #818cf8;
		background: rgba(99, 102, 241, 0.08);
	}
</style>
