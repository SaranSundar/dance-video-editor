<script lang="ts">
	import * as store from '$lib/store.svelte';
	import Dropdown from '$lib/components/Dropdown.svelte';
	import MultiSelect from '$lib/components/MultiSelect.svelte';
	import { getMovesForDance } from '$lib/moves';

	let {
		videoId,
		videoName,
		videoLead = '',
		videoFollow = '',
		videoDance = '',
		inPoint = $bindable(null),
		outPoint = $bindable(null),
		onClipSaved
	}: {
		videoId: string;
		videoName: string;
		videoLead?: string;
		videoFollow?: string;
		videoDance?: string;
		inPoint?: number | null;
		outPoint?: number | null;
		onClipSaved?: () => void;
	} = $props();

	let label = $state('');
	let style = $state('');
	let mastery = $state('');
	let clipType = $state('');

	const styles = ['', 'sensual', 'moderna', 'dominicana', 'fusion'];
	let tags = $state<string[]>([]);
	let saving = $state(false);
	let error = $state('');

	let moveOptions = $derived(getMovesForDance(videoDance));

	const masteryLevels = [
		{ value: 'seen', label: 'Seen it' },
		{ value: 'learning', label: 'Learning' },
		{ value: 'can do', label: 'Can do' },
		{ value: 'comfortable', label: 'Comfortable' },
		{ value: 'mastered', label: 'Mastered' },
	];
	const clipTypes = ['', 'move', 'pattern', 'styling', 'footwork'];

	let hasRange = $derived(inPoint !== null && outPoint !== null && outPoint > inPoint);

	function formatTime(seconds: number | null): string {
		if (seconds === null) return '--:--.--';
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		const ms = Math.floor((seconds % 1) * 100);
		return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
	}

	async function saveClip() {
		if (inPoint === null || outPoint === null) {
			error = 'Set both in and out points';
			return;
		}
		if (inPoint >= outPoint) {
			error = 'In-point must be before out-point';
			return;
		}
		if (!label.trim()) {
			error = 'Enter a label';
			return;
		}

		saving = true;
		error = '';

		try {
			await store.addClip({
				videoId,
				videoName,
				label: label.trim(),
				lead: videoLead,
				follow: videoFollow,
				dance: videoDance,
				style,
				mastery,
				clipType,
				startTime: inPoint,
				endTime: outPoint,
				tags
			});

			label = '';
			style = '';
			mastery = '';
			clipType = '';
			tags = [];
			inPoint = null;
			outPoint = null;
			onClipSaved?.();
		} catch (e) {
			error = `Failed to save clip: ${e}`;
		} finally {
			saving = false;
		}
	}
</script>

<div class="clip-marker">
	<div class="section-header">
		<h3>Create Clip</h3>
	</div>

	<div class="timecodes">
		<div class="timecode" class:set={inPoint !== null}>
			<span class="tc-label">IN</span>
			<div class="tc-row">
				<span class="tc-value">{formatTime(inPoint)}</span>
				{#if inPoint !== null}
					<button class="tc-clear" onclick={() => inPoint = null} title="Clear in-point">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
					</button>
				{/if}
			</div>
		</div>
		<div class="tc-arrow">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
			</svg>
		</div>
		<div class="timecode" class:set={outPoint !== null}>
			<span class="tc-label">OUT</span>
			<div class="tc-row">
				<span class="tc-value">{formatTime(outPoint)}</span>
				{#if outPoint !== null}
					<button class="tc-clear" onclick={() => outPoint = null} title="Clear out-point">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
					</button>
				{/if}
			</div>
		</div>
		{#if hasRange}
			<div class="timecode duration-tc">
				<span class="tc-label">DURATION</span>
				<span class="tc-value">{formatTime((outPoint ?? 0) - (inPoint ?? 0))}</span>
			</div>
		{/if}
	</div>

	<div class="form">
		<input
			type="text"
			placeholder="Move name - e.g. body wave, cross body lead"
			bind:value={label}
			disabled={saving}
		/>
		<div class="form-row">
			<Dropdown
				label="Style"
				bind:value={style}
				options={styles.slice(1).map(s => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
				disabled={saving}
			/>
			<Dropdown
				label="Mastery"
				bind:value={mastery}
				options={masteryLevels}
				disabled={saving}
			/>
			<Dropdown
				label="Type"
				bind:value={clipType}
				options={clipTypes.slice(1).map(t => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))}
				disabled={saving}
			/>
		</div>
		<MultiSelect
			label="Moves / Tags"
			bind:selected={tags}
			options={moveOptions}
			placeholder="Search moves..."
			disabled={saving}
		/>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<button class="save-btn" onclick={saveClip} disabled={saving || !hasRange}>
			{#if saving}
				Saving...
			{:else}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
					<polyline points="17 21 17 13 7 13 7 21" />
					<polyline points="7 3 7 8 15 8" />
				</svg>
				Save Clip
			{/if}
		</button>
	</div>

	<div class="shortcuts">
		<span><kbd>i</kbd> in-point</span>
		<span><kbd>o</kbd> out-point</span>
		<span><kbd>,</kbd><kbd>.</kbd> frame step</span>
		<span><kbd>Space</kbd> play/pause</span>
		<span><kbd>f</kbd> fullscreen</span>
	</div>
</div>

<style>
	.clip-marker {
		background: #18181b;
		border-radius: 12px;
		padding: 20px;
		border: 1px solid rgba(255, 255, 255, 0.04);
	}

	.section-header {
		margin-bottom: 16px;
	}

	h3 {
		margin: 0;
		color: #e4e4e7;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.timecodes {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 16px;
		flex-wrap: wrap;
	}

	.timecode {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.tc-label {
		font-size: 10px;
		text-transform: uppercase;
		color: #52525b;
		font-weight: 600;
		letter-spacing: 0.08em;
	}

	.tc-value {
		font-family: 'Inter', monospace;
		font-size: 15px;
		color: #52525b;
		font-variant-numeric: tabular-nums;
		font-weight: 500;
	}

	.timecode.set .tc-value {
		color: #e4e4e7;
	}

	.timecode.set .tc-label {
		color: #818cf8;
	}

	.duration-tc {
		margin-left: auto;
	}

	.duration-tc .tc-value {
		color: #a1a1aa;
	}

	.tc-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.tc-clear {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		color: #52525b;
		cursor: pointer;
		padding: 2px;
		border-radius: 4px;
		transition: color 0.15s, background 0.15s;
	}

	.tc-clear:hover {
		color: #ef4444;
		background: rgba(239, 68, 68, 0.08);
	}

	.tc-arrow {
		color: #3f3f46;
		padding-top: 14px;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	input, textarea {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #e4e4e7;
		padding: 10px 14px;
		border-radius: 8px;
		font-size: 13px;
		font-family: 'Inter', sans-serif;
		transition: border-color 0.15s;
		resize: none;
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 8px;
	}

	.form-row-2 {
		grid-template-columns: 1fr 1fr;
	}

	.form-row-4 {
		grid-template-columns: 1fr 1fr 1fr 1fr;
	}

	@media (max-width: 640px) {
		.form-row-4 {
			grid-template-columns: 1fr 1fr;
		}
	}

	.couple-presets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.preset-btn {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #71717a;
		padding: 5px 10px;
		border-radius: 14px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.preset-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.06);
		color: #a1a1aa;
	}

	.preset-btn.active {
		background: rgba(99, 102, 241, 0.12);
		color: #818cf8;
		border-color: rgba(99, 102, 241, 0.25);
	}

	.preset-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}


	input::placeholder, textarea::placeholder {
		color: #3f3f46;
	}

	input:focus, textarea:focus, select:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
	}

	input:disabled, textarea:disabled, select:disabled {
		opacity: 0.5;
	}

	.save-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		background: #6366f1;
		color: #fff;
		border: none;
		padding: 11px 20px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: background 0.15s, opacity 0.15s;
		margin-top: 2px;
	}

	.save-btn:hover:not(:disabled) {
		background: #7c3aed;
	}

	.save-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.error {
		color: #f87171;
		font-size: 12px;
		margin: 0;
		font-weight: 500;
	}

	.shortcuts {
		display: flex;
		gap: 14px;
		margin-top: 16px;
		padding-top: 14px;
		border-top: 1px solid rgba(255, 255, 255, 0.04);
		flex-wrap: wrap;
	}

	.shortcuts span {
		color: #3f3f46;
		font-size: 11px;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	kbd {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.08);
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 11px;
		font-family: 'Inter', monospace;
		color: #71717a;
	}
</style>
