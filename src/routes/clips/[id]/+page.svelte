<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import * as store from '$lib/store.svelte';
	import { extractClip } from '$lib/ffmpeg';
	import Dropdown from '$lib/components/Dropdown.svelte';
	import MultiSelect from '$lib/components/MultiSelect.svelte';
	import { getMovesForDance } from '$lib/moves';

	let clipId = $derived($page.params.id);
	let clip = $derived(store.getClips().find(c => c.id === clipId));

	let videoUrl = $state<string | null>(null);
	let videoEl: HTMLVideoElement | undefined = $state();
	let playing = $state(false);
	let playbackRate = $state(1);
	let looping = $state(true);

	// Editable fields
	let label = $state('');
	let lead = $state('');
	let follow = $state('');
	let dance = $state('');
	let style = $state('');
	let mastery = $state('');
	let clipType = $state('');
	let tags = $state<string[]>([]);
	let dirty = $state(false);
	let saving = $state(false);

	const couples: [string, string][] = [
		['Cornel', 'Rithika'],
		['Emilien', 'Tehina'],
		['Gero', 'Migle'],
		['Irakli', 'Maria'],
		['Luis', 'Andrea'],
		['Marcus', 'Bianca'],
	];
	const extraLeads = ['Favian'];
	const leadOptions = [...new Set([...couples.map(c => c[0]), ...extraLeads])].sort().map(n => ({ value: n, label: n }));
	const followOptions = [...new Set(couples.map(c => c[1]))].sort().map(n => ({ value: n, label: n }));
	const styles = ['sensual', 'moderna', 'dominicana', 'fusion'];
	const masteryLevels = [
		{ value: 'seen', label: 'Seen it' },
		{ value: 'learning', label: 'Learning' },
		{ value: 'can do', label: 'Can do' },
		{ value: 'comfortable', label: 'Comfortable' },
		{ value: 'mastered', label: 'Mastered' },
	];
	const clipTypes = ['move', 'pattern', 'styling', 'footwork'];

	let moveOptions = $derived(getMovesForDance(dance));

	function selectCouple(l: string, f: string) {
		lead = l;
		follow = f;
		dirty = true;
	}

	let clipDurationVal = $derived(clip ? clip.endTime - clip.startTime : 0);

	$effect(() => {
		const state = store.getState();
		if (state !== 'ready') return;
		if (!clip) {
			goto('/');
			return;
		}

		// Load source video blob
		store.getVideoBlob(clip.videoId).then((blob) => {
			videoUrl = URL.createObjectURL(blob);
		});

		// Populate form fields
		label = clip.label;
		lead = clip.lead || '';
		follow = clip.follow || '';
		dance = clip.dance || '';
		style = clip.style || '';
		mastery = clip.mastery || '';
		clipType = clip.clipType || '';
		tags = [...(clip.tags || [])];
		dirty = false;

		return () => {
			if (videoUrl) URL.revokeObjectURL(videoUrl);
		};
	});

	function markDirty() {
		dirty = true;
	}

	// Watch for field changes
	$effect(() => {
		// Access all fields to track them
		label; lead; follow; dance; style; mastery; clipType; tags;
		// Skip the initial population
		if (clip && store.getState() === 'ready') {
			dirty = true;
		}
	});

	async function save() {
		if (!clip) return;
		saving = true;
		await store.updateClip(clip.id, {
			label: label.trim(),
			lead,
			follow,
			dance,
			style,
			mastery,
			clipType,
			tags
		});
		dirty = false;
		saving = false;
	}

	async function deleteClip() {
		if (!clip) return;
		if (confirm('Delete this clip?')) {
			await store.deleteClip(clip.id);
			goto('/');
		}
	}

	let downloadingClip = $state(false);

	async function download() {
		if (!clip) return;
		downloadingClip = true;
		try {
			const blob = await store.getVideoBlob(clip.videoId);
			const clipBlob = await extractClip(blob, clip.startTime, clip.endTime);
			const url = URL.createObjectURL(clipBlob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${clip.label.replace(/[^a-z0-9]/gi, '_')}.mp4`;
			a.click();
			URL.revokeObjectURL(url);
		} finally {
			downloadingClip = false;
		}
	}

	let playerEl: HTMLElement | undefined = $state();
	let currentTime = $state(0);
	let clipDuration = $state(0);

	function togglePlay() {
		if (!videoEl || !clip) return;
		if (videoEl.paused) {
			// If at or past endTime, restart from beginning of clip
			if (videoEl.currentTime >= clip.endTime || videoEl.currentTime < clip.startTime) {
				videoEl.currentTime = clip.startTime;
			}
			videoEl.play();
		} else {
			videoEl.pause();
		}
	}

	function seek(delta: number) {
		if (!videoEl || !clip) return;
		videoEl.currentTime = Math.max(clip.startTime, Math.min(clip.endTime, videoEl.currentTime + delta));
	}

	function setRate(rate: number) {
		playbackRate = rate;
		if (videoEl) videoEl.playbackRate = rate;
	}

	function handleTimelineClick(e: MouseEvent) {
		if (!videoEl || !clip) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const pct = (e.clientX - rect.left) / rect.width;
		videoEl.currentTime = clip.startTime + Math.max(0, pct * clipDuration);
	}

	function formatTimeCode(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		const ms = Math.floor((seconds % 1) * 100);
		return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
	}

	function toggleFullscreen() {
		if (!playerEl) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			playerEl.requestFullscreen();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		switch (e.key) {
			case ' ':
				e.preventDefault();
				togglePlay();
				break;
			case 'ArrowLeft':
				e.preventDefault();
				seek(e.shiftKey ? -5 : -1);
				break;
			case 'ArrowRight':
				e.preventDefault();
				seek(e.shiftKey ? 5 : 1);
				break;
			case ',':
				e.preventDefault();
				seek(-1 / 30);
				break;
			case '.':
				e.preventDefault();
				seek(1 / 30);
				break;
			case 'f':
				toggleFullscreen();
				break;
		}
	}

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	const rates = [0.25, 0.5, 0.75, 1, 1.5, 2];
</script>

<svelte:window onkeydown={handleKeydown} />

{#if clip && videoUrl}
	<div class="clip-page">
		<div class="top-bar">
			<a href="/" class="back">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="15 18 9 12 15 6" />
				</svg>
				Back
			</a>
			<div class="top-actions">
				<button class="top-btn" onclick={download} disabled={downloadingClip}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
					</svg>
					{downloadingClip ? 'Extracting...' : 'Download'}
				</button>
				<button class="top-btn danger" onclick={deleteClip}>Delete</button>
			</div>
		</div>

		<div class="layout">
			<div class="player-section" bind:this={playerEl}>
				<div class="player-wrapper">
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						bind:this={videoEl}
						src={videoUrl}
						onclick={togglePlay}
						onplay={() => playing = true}
						onpause={() => playing = false}
						ontimeupdate={() => {
							if (!videoEl || !clip) return;
							if (videoEl.currentTime >= clip.endTime) {
								if (looping) {
									videoEl.currentTime = clip.startTime;
									videoEl.play();
								} else {
									videoEl.pause();
									videoEl.currentTime = clip.endTime;
								}
							}
							currentTime = videoEl.currentTime - clip.startTime;
						}}
						onloadedmetadata={() => {
							if (videoEl && clip) {
								clipDuration = clip.endTime - clip.startTime;
								videoEl.currentTime = clip.startTime;
							}
						}}
					></video>
				</div>

				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div class="timeline" role="slider" tabindex="0" aria-valuenow={currentTime} aria-valuemin={0} aria-valuemax={clipDuration} onclick={handleTimelineClick}>
					<div class="timeline-track">
						<div class="timeline-progress" style="width: {clipDuration > 0 ? (currentTime / clipDuration) * 100 : 0}%"></div>
						<div class="timeline-head" style="left: {clipDuration > 0 ? (currentTime / clipDuration) * 100 : 0}%"></div>
					</div>
				</div>

				<div class="player-controls">
					<div class="controls-left">
						<button class="ctrl-btn play-btn" onclick={togglePlay}>
							{#if playing}
								<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
							{:else}
								<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
							{/if}
						</button>

						<button
							class="ctrl-btn loop-toggle"
							class:active={looping}
							onclick={() => looping = !looping}
							title={looping ? 'Looping on' : 'Looping off'}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
								<polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
							</svg>
						</button>

						<span class="clip-time">{formatTimeCode(currentTime)}<span class="time-sep">/</span>{formatTimeCode(clipDuration)}</span>
					</div>

					<div class="rate-group">
						{#each rates as rate}
							<button
								class="rate-btn"
								class:active={playbackRate === rate}
								onclick={() => setRate(rate)}
							>{rate}x</button>
						{/each}
					</div>

					<button class="ctrl-btn" onclick={toggleFullscreen} title="Fullscreen (f)">
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
							<line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
						</svg>
					</button>
				</div>
			</div>

			<div class="edit-section">
				<div class="edit-header">
					<h1>{clip.label}</h1>
					<a href="/videos/{clip.videoId}" class="source-link">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
						</svg>
						{clip.videoName} - {formatTime(clip.startTime)} to {formatTime(clip.endTime)}
					</a>
				</div>

				<div class="edit-form">
					<span class="form-section-label">Clip details</span>
					<input
						type="text"
						placeholder="Move name"
						bind:value={label}
						oninput={markDirty}
					/>

					<div class="form-row">
						<Dropdown label="Style" bind:value={style} options={styles.map(s => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} />
						<Dropdown label="Mastery" bind:value={mastery} options={masteryLevels} />
						<Dropdown label="Type" bind:value={clipType} options={clipTypes.map(t => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))} />
					</div>

					<MultiSelect
						label="Moves / Tags"
						bind:selected={tags}
						options={moveOptions}
						placeholder="Search moves..."
					/>

					<div class="form-divider"></div>

					<span class="form-section-label">From video</span>

					<div class="couple-presets">
						{#each couples as [l, f]}
							<button
								type="button"
								class="preset-btn"
								class:active={lead === l && follow === f}
								onclick={() => selectCouple(l, f)}
							>{l} & {f}</button>
						{/each}
					</div>

					<div class="form-row">
						<Dropdown label="Lead" bind:value={lead} options={leadOptions} placeholder="Select lead..." />
						<Dropdown label="Follow" bind:value={follow} options={followOptions} placeholder="Select follow..." />
					</div>

					<div class="form-row form-row-2">
						<Dropdown label="Dance" bind:value={dance} options={[{ value: 'bachata', label: 'Bachata' }, { value: 'salsa', label: 'Salsa' }]} />
					</div>

					<button class="save-btn" onclick={save} disabled={!dirty || saving}>
						{#if saving}
							<span class="spinner"></span>
							Saving...
						{:else}
							Save Changes
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{:else}
	<div class="loading">
		<div class="loading-spinner"></div>
	</div>
{/if}

<style>
	.clip-page {
		max-width: 1200px;
		margin: 0 auto;
		overflow-x: hidden;
	}

	.top-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 20px;
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: #52525b;
		text-decoration: none;
		font-size: 13px;
		font-weight: 500;
		transition: color 0.15s;
	}

	.back:hover {
		color: #a1a1aa;
	}

	.top-actions {
		display: flex;
		gap: 8px;
	}

	.top-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		background: rgba(255, 255, 255, 0.04);
		color: #a1a1aa;
		border: 1px solid rgba(255, 255, 255, 0.06);
		padding: 7px 14px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.top-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
	}

	.top-btn.danger:hover {
		color: #ef4444;
		border-color: rgba(239, 68, 68, 0.2);
		background: rgba(239, 68, 68, 0.06);
	}

	.layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: 24px;
	}

	@media (min-width: 900px) {
		.layout {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}
	}

	.player-section {
		position: sticky;
		top: 76px;
	}

	.player-wrapper {
		background: #000;
		border-radius: 10px;
		overflow: hidden;
		line-height: 0;
	}

	.player-wrapper video {
		width: 100%;
		display: block;
		max-height: 50vh;
		object-fit: contain;
		cursor: pointer;
		background: #000;
	}

	:global(.player-section:fullscreen) {
		background: #000;
		display: flex;
		flex-direction: column;
	}

	:global(.player-section:fullscreen .player-wrapper) {
		flex: 1;
		display: flex;
		align-items: center;
	}

	:global(.player-section:fullscreen video) {
		max-height: none;
		flex: 1;
	}

	.timeline {
		position: relative;
		height: 24px;
		cursor: pointer;
		padding: 8px 0;
	}

	.timeline-track {
		position: relative;
		height: 4px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 2px;
	}

	.timeline:hover .timeline-track {
		height: 6px;
		margin-top: -1px;
	}

	.timeline-progress {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: #818cf8;
		border-radius: 2px;
		pointer-events: none;
	}

	.timeline-head {
		position: absolute;
		top: 50%;
		width: 12px;
		height: 12px;
		background: #c7d2fe;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.15s;
		box-shadow: 0 0 8px rgba(129, 140, 248, 0.5);
	}

	.timeline:hover .timeline-head {
		opacity: 1;
	}

	.clip-time {
		font-size: 12px;
		color: #71717a;
		font-variant-numeric: tabular-nums;
		font-family: 'Inter', monospace;
		margin-left: 4px;
	}

	.time-sep {
		color: #3f3f46;
		margin: 0 3px;
	}

	.player-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 0 10px;
		gap: 8px;
		flex-wrap: wrap;
	}

	.controls-left {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.ctrl-btn {
		background: none;
		color: #a1a1aa;
		border: none;
		padding: 6px;
		border-radius: 6px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.15s, background 0.15s;
	}

	.ctrl-btn:hover {
		color: #e4e4e7;
		background: rgba(255, 255, 255, 0.06);
	}

	.play-btn {
		width: 36px;
		height: 36px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 50%;
		color: #e4e4e7;
	}

	.play-btn:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.play-btn svg {
		margin-left: 1px;
	}

	.loop-toggle.active {
		color: #818cf8;
	}

	.loop-toggle:not(.active) {
		color: #3f3f46;
	}

	.clip-duration {
		font-size: 12px;
		color: #52525b;
		font-variant-numeric: tabular-nums;
		margin-left: 4px;
	}

	.rate-group {
		display: flex;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 6px;
		border: 1px solid rgba(255, 255, 255, 0.04);
		overflow: hidden;
	}

	.rate-btn {
		background: none;
		color: #52525b;
		border: none;
		padding: 5px 7px;
		cursor: pointer;
		font-size: 11px;
		font-weight: 500;
		transition: all 0.15s;
		font-family: 'Inter', sans-serif;
	}

	.rate-btn:hover {
		color: #a1a1aa;
	}

	.rate-btn.active {
		color: #e4e4e7;
		background: rgba(255, 255, 255, 0.08);
	}

	.edit-section {
		background: #18181b;
		border-radius: 12px;
		padding: 24px;
		border: 1px solid rgba(255, 255, 255, 0.04);
		min-width: 0;
		overflow: hidden;
	}

	@media (max-width: 640px) {
		.edit-section {
			padding: 16px;
		}
	}

	.edit-header {
		margin-bottom: 20px;
	}

	.edit-header h1 {
		font-size: 20px;
		font-weight: 600;
		margin: 0 0 4px;
		letter-spacing: -0.02em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.source-link {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: #71717a;
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
		font-variant-numeric: tabular-nums;
		transition: color 0.15s;
		padding: 8px 14px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		margin-top: 8px;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.source-link:hover {
		color: #818cf8;
		border-color: rgba(99, 102, 241, 0.2);
		background: rgba(99, 102, 241, 0.04);
	}

	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.form-section-label {
		font-size: 11px;
		text-transform: uppercase;
		color: #52525b;
		font-weight: 600;
		letter-spacing: 0.06em;
	}

	.form-divider {
		height: 1px;
		background: rgba(255, 255, 255, 0.06);
		margin: 6px 0;
	}

	input {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #e4e4e7;
		padding: 10px 14px;
		border-radius: 8px;
		font-size: 13px;
		font-family: 'Inter', sans-serif;
		transition: border-color 0.15s;
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}

	input::placeholder {
		color: #3f3f46;
	}

	input:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
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

	.preset-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		color: #a1a1aa;
	}

	.preset-btn.active {
		background: rgba(99, 102, 241, 0.12);
		color: #818cf8;
		border-color: rgba(99, 102, 241, 0.25);
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		min-width: 0;
	}

	.form-row-4 {
		grid-template-columns: 1fr 1fr;
	}

	@media (max-width: 400px) {
		.form-row {
			grid-template-columns: 1fr;
		}
		.form-row-4 {
			grid-template-columns: 1fr;
		}
	}

	@media (min-width: 500px) {
		.form-row-4 {
			grid-template-columns: 1fr 1fr 1fr 1fr;
		}
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
		margin-top: 4px;
	}

	.save-btn:hover:not(:disabled) {
		background: #7c3aed;
	}

	.save-btn:disabled {
		opacity: 0.35;
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

	.loading {
		display: flex;
		justify-content: center;
		padding: 80px 0;
	}

	.loading-spinner {
		width: 24px;
		height: 24px;
		border: 2px solid rgba(255, 255, 255, 0.06);
		border-top-color: #818cf8;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
</style>
