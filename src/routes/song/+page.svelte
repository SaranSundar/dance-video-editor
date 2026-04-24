<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as store from '$lib/store.svelte';
	import type { VideoMeta, VideoSection } from '$lib/store.svelte';

	type Phase = 'idle' | 'playing' | 'paused' | 'ended';

	const CONFIG_KEY = 'song-config-v1';
	const DEFAULT_BPM = 130;

	let selectedVideoId = $state<string | null>(null);
	let bpm = $state(DEFAULT_BPM);
	let numSections = $state(4);
	let defaultLoops = $state(2);
	let pickerSearch = $state('');
	let showPicker = $state(false);
	let playbackRate = $state(1);

	const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const;

	let phase = $state<Phase>('idle');
	let audioEl = $state<HTMLAudioElement | undefined>();
	let audioUrl = $state('');
	let currentSectionIdx = $state(0);
	let currentLoop = $state(1);
	let needsSeek = $state(false);
	let segElapsed = $state(0);

	const videos = $derived(store.getVideos());
	const selectedVideo = $derived<VideoMeta | null>(
		selectedVideoId ? videos.find(v => v.id === selectedVideoId) ?? null : null
	);
	const sections = $derived<VideoSection[]>(selectedVideo?.sections ?? []);
	const songLen = $derived(selectedVideo?.duration ?? 0);
	const secondsPer8Count = $derived(bpm > 0 ? (8 * 60) / bpm : 4);
	const totalEights = $derived(Math.max(1, Math.floor(songLen / secondsPer8Count)));
	const currentSection = $derived<VideoSection | null>(
		sections[currentSectionIdx] ?? null
	);
	const segDur = $derived(currentSection ? currentSection.endTime - currentSection.startTime : 0);
	const progressPct = $derived(segDur > 0 ? Math.min(100, (segElapsed / segDur) * 100) : 0);

	const filteredVideos = $derived(
		[...videos]
			.filter(v => {
				if (!pickerSearch) return true;
				const q = pickerSearch.toLowerCase();
				return v.name.toLowerCase().includes(q)
					|| v.lead.toLowerCase().includes(q)
					|| v.follow.toLowerCase().includes(q);
			})
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	onMount(() => {
		try {
			const raw = localStorage.getItem(CONFIG_KEY);
			if (!raw) return;
			const c = JSON.parse(raw);
			if (typeof c.selectedVideoId === 'string') selectedVideoId = c.selectedVideoId;
			if (typeof c.bpm === 'number') bpm = c.bpm;
			if (typeof c.numSections === 'number') numSections = c.numSections;
			if (typeof c.defaultLoops === 'number') defaultLoops = c.defaultLoops;
			if (typeof c.playbackRate === 'number' && SPEEDS.includes(c.playbackRate as never)) playbackRate = c.playbackRate;
		} catch {
			// ignore
		}
	});

	$effect(() => {
		const c = { selectedVideoId, bpm, numSections, defaultLoops, playbackRate };
		try {
			localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
		} catch {
			// ignore
		}
	});

	// Apply saved BPM from VideoMeta if it has one
	$effect(() => {
		if (selectedVideo?.bpm && selectedVideo.bpm > 0) {
			bpm = selectedVideo.bpm;
		}
	});

	function autoDistribute() {
		if (!selectedVideo || numSections < 1) return;
		const eights = totalEights;
		const per = Math.max(1, Math.floor(eights / numSections));
		const rem = eights - per * numSections;
		const out: VideoSection[] = [];
		let cursor = 0;
		for (let i = 0; i < numSections; i++) {
			const e = per + (i < rem ? 1 : 0);
			const dur = e * secondsPer8Count;
			const end = i === numSections - 1 ? songLen : cursor + dur;
			out.push({
				id: crypto.randomUUID(),
				name: `Section ${i + 1}`,
				startTime: cursor,
				endTime: end,
				loopCount: defaultLoops,
			});
			cursor = end;
		}
		store.updateVideo(selectedVideo.id, { sections: out });
	}

	function snapToEight(t: number): number {
		return Math.round(t / secondsPer8Count) * secondsPer8Count;
	}

	function clearSections() {
		if (!selectedVideo) return;
		store.updateVideo(selectedVideo.id, { sections: [] });
	}

	function updateSection(id: string, patch: Partial<VideoSection>) {
		if (!selectedVideo) return;
		const next = sections.map(s => s.id === id ? { ...s, ...patch } : s);
		store.updateVideo(selectedVideo.id, { sections: next });
	}

	function deleteSection(id: string) {
		if (!selectedVideo || sections.length <= 1) return;
		const idx = sections.findIndex(s => s.id === id);
		if (idx < 0) return;
		const next = sections.filter(s => s.id !== id);
		// Stitch: previous section absorbs the deleted section's range
		if (idx > 0 && idx < sections.length) {
			next[idx - 1] = { ...next[idx - 1], endTime: sections[idx].endTime };
		} else if (idx === 0 && next.length > 0) {
			next[0] = { ...next[0], startTime: sections[0].startTime };
		}
		store.updateVideo(selectedVideo.id, { sections: next });
		if (currentSectionIdx >= next.length) currentSectionIdx = Math.max(0, next.length - 1);
	}

	function setSectionBoundary(boundaryIdx: number, newTime: number) {
		// boundaryIdx N is the boundary between sections[N] and sections[N+1]
		if (!selectedVideo) return;
		if (boundaryIdx < 0 || boundaryIdx >= sections.length - 1) return;
		const minBoundary = sections[boundaryIdx].startTime + 1;
		const maxBoundary = sections[boundaryIdx + 1].endTime - 1;
		const t = Math.max(minBoundary, Math.min(maxBoundary, snapToEight(newTime)));
		const next = sections.map((s, i) => {
			if (i === boundaryIdx) return { ...s, endTime: t };
			if (i === boundaryIdx + 1) return { ...s, startTime: t };
			return s;
		});
		store.updateVideo(selectedVideo.id, { sections: next });
	}

	// --- Drag for handles ---
	let dragBoundaryIdx = $state<number | null>(null);
	let trackEl = $state<HTMLDivElement | undefined>();

	function handleHandleDown(idx: number, e: PointerEvent) {
		e.preventDefault();
		dragBoundaryIdx = idx;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handleHandleMove(e: PointerEvent) {
		if (dragBoundaryIdx === null || !trackEl || songLen <= 0) return;
		const rect = trackEl.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		setSectionBoundary(dragBoundaryIdx, ratio * songLen);
	}

	function handleHandleUp(e: PointerEvent) {
		dragBoundaryIdx = null;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
	}

	// --- Player ---
	function startPlayback() {
		if (!selectedVideo || sections.length === 0 || !audioEl) return;
		const url = store.getCdnUrlForVideo(selectedVideo.id);
		if (!url) return;
		currentSectionIdx = 0;
		currentLoop = 1;
		segElapsed = 0;
		phase = 'playing';
		needsSeek = true;
		audioUrl = url;
		// If src didn't change (same as last load), seek directly
		if (audioEl.src === url) {
			needsSeek = false;
			audioEl.currentTime = sections[0].startTime;
			audioEl.playbackRate = playbackRate;
			audioEl.play().catch(() => {});
		}
	}

	function handleAudioLoaded() {
		if (!audioEl || !needsSeek || !currentSection) return;
		needsSeek = false;
		audioEl.currentTime = currentSection.startTime;
		audioEl.playbackRate = playbackRate;
		audioEl.play().catch(() => {});
	}

	function handleTimeUpdate() {
		if (!audioEl || phase !== 'playing' || needsSeek || !currentSection) return;
		const elapsed = audioEl.currentTime - currentSection.startTime;
		segElapsed = Math.max(0, elapsed);
		if (audioEl.currentTime >= currentSection.endTime) {
			advanceSegment();
		}
	}

	function advanceSegment() {
		if (!currentSection || !audioEl) return;
		if (currentLoop < currentSection.loopCount) {
			currentLoop += 1;
			segElapsed = 0;
			audioEl.currentTime = currentSection.startTime;
			audioEl.play().catch(() => {});
			return;
		}
		// Move to next section
		if (currentSectionIdx >= sections.length - 1) {
			endPlayback();
			return;
		}
		currentSectionIdx += 1;
		currentLoop = 1;
		segElapsed = 0;
		const s = sections[currentSectionIdx];
		audioEl.currentTime = s.startTime;
		audioEl.play().catch(() => {});
	}

	function previousSegment() {
		if (!audioEl || sections.length === 0) return;
		if (currentLoop > 1) {
			currentLoop -= 1;
			segElapsed = 0;
			if (currentSection) audioEl.currentTime = currentSection.startTime;
			audioEl.play().catch(() => {});
			return;
		}
		if (currentSectionIdx <= 0) return;
		currentSectionIdx -= 1;
		currentLoop = 1;
		segElapsed = 0;
		const s = sections[currentSectionIdx];
		audioEl.currentTime = s.startTime;
		audioEl.play().catch(() => {});
	}

	function nextSegment() {
		if (!audioEl || sections.length === 0) return;
		if (currentSectionIdx >= sections.length - 1) {
			endPlayback();
			return;
		}
		currentSectionIdx += 1;
		currentLoop = 1;
		segElapsed = 0;
		const s = sections[currentSectionIdx];
		audioEl.currentTime = s.startTime;
		audioEl.play().catch(() => {});
	}

	function togglePause() {
		if (!audioEl) return;
		if (phase === 'playing') { audioEl.pause(); phase = 'paused'; }
		else if (phase === 'paused') { phase = 'playing'; audioEl.play().catch(() => {}); }
	}

	function endPlayback() {
		if (audioEl) audioEl.pause();
		phase = 'ended';
	}

	function resetToIdle() {
		if (audioEl) audioEl.pause();
		phase = 'idle';
		currentSectionIdx = 0;
		currentLoop = 1;
		segElapsed = 0;
	}

	function setSpeed(s: number) {
		playbackRate = s;
		if (audioEl) audioEl.playbackRate = s;
	}

	function seekSegment(e: MouseEvent) {
		if (!audioEl || !currentSection) return;
		const bar = e.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		const newElapsed = pct * segDur;
		audioEl.currentTime = currentSection.startTime + newElapsed;
		segElapsed = newElapsed;
	}

	function pickVideo(id: string) {
		selectedVideoId = id;
		showPicker = false;
		pickerSearch = '';
		resetToIdle();
	}

	function setBpmAndPersist(newBpm: number) {
		bpm = newBpm;
		if (selectedVideo) {
			store.updateVideo(selectedVideo.id, { bpm: newBpm });
		}
	}

	function formatTime(s: number): string {
		if (!isFinite(s) || s < 0) s = 0;
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	const playerActive = $derived(phase === 'playing' || phase === 'paused');

	onDestroy(() => {
		if (audioEl) audioEl.pause();
	});
</script>

<svelte:window
	onpointermove={handleHandleMove}
	onpointerup={handleHandleUp}
/>

<audio
	bind:this={audioEl}
	src={audioUrl}
	preload="auto"
	onloadedmetadata={handleAudioLoaded}
	ontimeupdate={handleTimeUpdate}
></audio>

<div class="page">
	<header class="hero">
		<h1>Song Sections</h1>
		<p class="sub">Split a song into timed sections, loop each as many times as you need.</p>
	</header>

	<!-- Player -->
	<section class="player-card" class:active={playerActive}>
		{#if !selectedVideo}
			<div class="idle">
				<p class="hint">Pick a song below to get started.</p>
			</div>
		{:else if sections.length === 0}
			<div class="idle">
				<div class="song-name">{selectedVideo.name}</div>
				<p class="hint">No sections yet. Set BPM + count below and hit <strong>Generate sections</strong>.</p>
			</div>
		{:else if phase === 'idle'}
			<div class="idle">
				<div class="song-name">{selectedVideo.name}</div>
				<div class="meta-row">
					<span>{sections.length} sections</span>
					<span class="dot"></span>
					<span>{bpm} BPM</span>
					<span class="dot"></span>
					<span>{formatTime(songLen)}</span>
				</div>
				<button class="start-btn" onclick={startPlayback}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
						<polygon points="5 3 19 12 5 21 5 3" />
					</svg>
					Play sections
				</button>
			</div>
		{:else if phase === 'ended'}
			<div class="ended">
				<h2>Done</h2>
				<div class="ended-actions">
					<button class="start-btn" onclick={startPlayback}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
						Play again
					</button>
					<button class="ghost-btn" onclick={resetToIdle}>Done</button>
				</div>
			</div>
		{:else if currentSection}
			<div class="now-playing">
				<div class="now-header">
					<div class="now-title">
						<div class="section-name">{currentSection.name ?? `Section ${currentSectionIdx + 1}`}</div>
						<div class="now-meta">
							<span>{currentSectionIdx + 1} / {sections.length}</span>
							{#if currentSection.loopCount > 1}
								<span class="dot"></span>
								<span>loop {currentLoop}/{currentSection.loopCount}</span>
							{/if}
							<span class="dot"></span>
							<span>{formatTime(currentSection.startTime)} – {formatTime(currentSection.endTime)}</span>
						</div>
					</div>
					<button class="icon-btn" onclick={endPlayback} title="Stop">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
							<rect x="5" y="5" width="14" height="14" rx="1" />
						</svg>
					</button>
				</div>
				<div class="countdown">
					<div class="time-left">{Math.max(0, Math.ceil(segDur - segElapsed))}s</div>
				</div>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="progress-bar seekable" onclick={seekSegment}>
					<div class="progress-fill" style="width: {progressPct}%"></div>
				</div>
				<div class="controls">
					<button class="ctrl-btn" onclick={previousSegment} disabled={currentSectionIdx === 0 && currentLoop === 1} title="Previous">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="19 20 9 12 19 4" /><line x1="5" y1="4" x2="5" y2="20" /></svg>
						Prev
					</button>
					<button class="ctrl-btn primary" onclick={togglePause}>
						{#if phase === 'playing'}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
							Pause
						{:else}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
							Resume
						{/if}
					</button>
					<button class="ctrl-btn" onclick={nextSegment}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="5 4 15 12 5 20" /><line x1="19" y1="4" x2="19" y2="20" /></svg>
						Next
					</button>
					<select class="speed-select" value={playbackRate} onchange={(e) => setSpeed(Number((e.target as HTMLSelectElement).value))}>
						{#each SPEEDS as s}
							<option value={s}>{s}×</option>
						{/each}
					</select>
				</div>
			</div>
		{/if}
	</section>

	<!-- Song picker -->
	<section class="panel">
		<div class="panel-header">
			<h2>Song</h2>
			<button class="ghost-btn small" onclick={() => showPicker = !showPicker}>
				{showPicker ? 'Hide' : selectedVideo ? 'Change' : 'Pick song'}
			</button>
		</div>
		{#if selectedVideo && !showPicker}
			<div class="selected-song">
				<div class="picker-info">
					<div class="picker-name">{selectedVideo.name}</div>
					<div class="picker-meta">
						{#if selectedVideo.lead}{selectedVideo.lead}{#if selectedVideo.follow} &amp; {selectedVideo.follow}{/if}{/if}
						{#if selectedVideo.dance}<span class="badge sm">{selectedVideo.dance}</span>{/if}
						<span>{formatTime(selectedVideo.duration)}</span>
					</div>
				</div>
			</div>
		{/if}
		{#if showPicker}
			<input type="text" class="search" placeholder="Search videos..." bind:value={pickerSearch} />
			<div class="picker-list">
				{#each filteredVideos as v (v.id)}
					<button class="picker-row" class:active={v.id === selectedVideoId} onclick={() => pickVideo(v.id)}>
						<div class="picker-info">
							<div class="picker-name">{v.name}</div>
							<div class="picker-meta">
								{#if v.lead}{v.lead}{#if v.follow} &amp; {v.follow}{/if}{/if}
								{#if v.dance}<span class="badge sm">{v.dance}</span>{/if}
								<span>{formatTime(v.duration)}</span>
								{#if v.sections && v.sections.length > 0}
									<span class="badge sm sections-badge">{v.sections.length} sections</span>
								{/if}
							</div>
						</div>
					</button>
				{/each}
				{#if filteredVideos.length === 0}
					<p class="empty">No videos found.</p>
				{/if}
			</div>
		{/if}
	</section>

	{#if selectedVideo}
		<!-- Section generator -->
		<section class="panel">
			<div class="panel-header">
				<h2>Generate</h2>
			</div>
			<div class="cfg-grid">
				<div class="cfg-field">
					<label for="bpm-input" class="field-label-as-label">BPM</label>
					<div class="number-row">
						<input
							id="bpm-input"
							type="number"
							class="num-input wide"
							min="40"
							max="240"
							step="1"
							value={bpm}
							oninput={(e) => {
								const v = parseFloat((e.target as HTMLInputElement).value);
								if (!isNaN(v)) setBpmAndPersist(Math.max(40, Math.min(240, v)));
							}}
						/>
						<span class="num-suffix">{secondsPer8Count.toFixed(2)}s per 8-count · {totalEights} 8-counts in song</span>
					</div>
				</div>
				<div class="cfg-field">
					<label for="num-sections" class="field-label-as-label">Number of sections</label>
					<div class="number-row">
						<button class="num-btn" onclick={() => numSections = Math.max(1, numSections - 1)} disabled={numSections <= 1} aria-label="Decrease">−</button>
						<input
							id="num-sections"
							type="number"
							class="num-input"
							min="1"
							max="32"
							step="1"
							value={numSections}
							oninput={(e) => {
								const v = parseInt((e.target as HTMLInputElement).value, 10);
								if (!isNaN(v)) numSections = Math.max(1, Math.min(32, v));
							}}
						/>
						<button class="num-btn" onclick={() => numSections = Math.min(32, numSections + 1)} disabled={numSections >= 32} aria-label="Increase">+</button>
						<span class="num-suffix">~{Math.floor(totalEights / numSections)} 8-counts each</span>
					</div>
				</div>
				<div class="cfg-field">
					<label for="default-loops" class="field-label-as-label">Default loops per section</label>
					<div class="number-row">
						<button class="num-btn" onclick={() => defaultLoops = Math.max(1, defaultLoops - 1)} disabled={defaultLoops <= 1} aria-label="Decrease">−</button>
						<input
							id="default-loops"
							type="number"
							class="num-input"
							min="1"
							max="20"
							step="1"
							value={defaultLoops}
							oninput={(e) => {
								const v = parseInt((e.target as HTMLInputElement).value, 10);
								if (!isNaN(v)) defaultLoops = Math.max(1, Math.min(20, v));
							}}
						/>
						<button class="num-btn" onclick={() => defaultLoops = Math.min(20, defaultLoops + 1)} disabled={defaultLoops >= 20} aria-label="Increase">+</button>
					</div>
				</div>
				<div class="actions-row">
					<button class="primary-btn" onclick={autoDistribute}>
						{sections.length > 0 ? 'Regenerate sections' : 'Generate sections'}
					</button>
					{#if sections.length > 0}
						<button class="ghost-btn small" onclick={clearSections}>Clear all</button>
					{/if}
				</div>
				{#if sections.length > 0}
					<p class="cfg-hint">Regenerating replaces current sections.</p>
				{/if}
			</div>
		</section>

		<!-- Sections editor -->
		{#if sections.length > 0}
			<section class="panel">
				<div class="panel-header">
					<h2>Sections</h2>
					<span class="header-count">{formatTime(songLen)} song</span>
				</div>

				<!-- Visual timeline with drag handles -->
				<div class="timeline" bind:this={trackEl}>
					{#each sections as s, i (s.id)}
						<div
							class="seg-block"
							class:active={i === currentSectionIdx && playerActive}
							style="left: {(s.startTime / songLen) * 100}%; width: {((s.endTime - s.startTime) / songLen) * 100}%; background-color: hsl({(i * 360) / sections.length}, 50%, 28%);"
							title="{s.name ?? `Section ${i + 1}`} ({formatTime(s.startTime)} – {formatTime(s.endTime)})"
						>
							<span class="seg-label">{s.name ?? i + 1}</span>
						</div>
					{/each}
					{#each sections.slice(0, -1) as s, i (s.id + '-h')}
						<button
							class="handle"
							class:dragging={dragBoundaryIdx === i}
							style="left: {(s.endTime / songLen) * 100}%;"
							onpointerdown={(e) => handleHandleDown(i, e)}
							aria-label={`Drag boundary ${i + 1}`}
						></button>
					{/each}
				</div>

				<div class="section-list">
					{#each sections as s, i (s.id)}
						<div class="section-row" class:active={i === currentSectionIdx && playerActive}>
							<span class="seg-index">{i + 1}</span>
							<input
								type="text"
								class="seg-name-input"
								value={s.name ?? ''}
								oninput={(e) => updateSection(s.id, { name: (e.target as HTMLInputElement).value })}
								placeholder={`Section ${i + 1}`}
							/>
							<span class="seg-time">{formatTime(s.startTime)} – {formatTime(s.endTime)}</span>
							<span class="seg-dur">{Math.round((s.endTime - s.startTime) / secondsPer8Count)} × 8</span>
							<div class="seg-loops">
								<button class="num-btn tiny" onclick={() => updateSection(s.id, { loopCount: Math.max(1, s.loopCount - 1) })} disabled={s.loopCount <= 1} aria-label="Decrease">−</button>
								<span class="loop-val">{s.loopCount}×</span>
								<button class="num-btn tiny" onclick={() => updateSection(s.id, { loopCount: Math.min(20, s.loopCount + 1) })} disabled={s.loopCount >= 20} aria-label="Increase">+</button>
							</div>
							<button class="row-btn danger" onclick={() => deleteSection(s.id)} disabled={sections.length <= 1} title="Delete section">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
							</button>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

<style>
	.page {
		max-width: 720px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.hero h1 {
		font-size: 24px;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin: 0 0 4px;
	}
	.hero .sub { margin: 0; color: #71717a; font-size: 13px; }

	.player-card {
		background: #111113;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 14px;
		padding: 24px;
		transition: border-color 0.2s;
	}
	.player-card.active {
		border-color: rgba(99, 102, 241, 0.3);
		background: linear-gradient(180deg, rgba(99, 102, 241, 0.05) 0%, #111113 100%);
	}

	.idle {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 16px 0;
		text-align: center;
	}
	.song-name {
		font-size: 18px;
		font-weight: 700;
		color: #e4e4e7;
	}
	.meta-row {
		display: flex;
		align-items: center;
		gap: 8px;
		color: #71717a;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}
	.dot { width: 3px; height: 3px; border-radius: 50%; background: #3f3f46; }

	.start-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		background: #6366f1;
		color: #fff;
		border: none;
		padding: 12px 24px;
		border-radius: 10px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
		transition: background 0.15s;
	}
	.start-btn:hover:not(:disabled) { background: #7c3aed; }
	.start-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.hint { margin: 4px 0 0; color: #52525b; font-size: 12px; }

	.ended { text-align: center; padding: 20px 0; }
	.ended h2 { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
	.ended-actions { display: flex; gap: 10px; justify-content: center; }

	.now-header {
		display: flex; justify-content: space-between; align-items: flex-start;
		gap: 12px; margin-bottom: 16px;
	}
	.section-name {
		font-size: 18px; font-weight: 700; color: #e4e4e7;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.now-meta {
		margin-top: 4px; color: #71717a; font-size: 12px;
		display: flex; align-items: center; gap: 6px;
	}

	.countdown {
		display: flex; justify-content: center; padding: 14px 0;
	}
	.time-left {
		font-size: 56px; font-weight: 700; color: #e4e4e7;
		font-variant-numeric: tabular-nums; letter-spacing: -0.04em;
		line-height: 1;
	}

	.progress-bar {
		height: 6px; background: rgba(255, 255, 255, 0.06);
		border-radius: 3px; overflow: hidden; margin-bottom: 16px;
	}
	.progress-bar.seekable { cursor: pointer; }
	.progress-bar.seekable:hover { height: 8px; }
	.progress-fill { height: 100%; background: #6366f1; transition: width 0.15s linear; }

	.controls {
		display: flex; gap: 8px; justify-content: center; align-items: center;
	}
	.ctrl-btn {
		display: flex; align-items: center; gap: 6px;
		background: rgba(255, 255, 255, 0.04); color: #e4e4e7;
		border: 1px solid rgba(255, 255, 255, 0.06);
		padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
		cursor: pointer; font-family: inherit;
	}
	.ctrl-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.08);
	}
	.ctrl-btn.primary { background: #6366f1; border-color: #6366f1; color: #fff; }
	.ctrl-btn.primary:hover:not(:disabled) { background: #7c3aed; border-color: #7c3aed; }
	.ctrl-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.icon-btn {
		background: none; border: none; color: #52525b;
		padding: 6px; border-radius: 6px; cursor: pointer; display: flex; align-items: center;
	}
	.icon-btn:hover { color: #e4e4e7; background: rgba(255, 255, 255, 0.04); }

	.speed-select {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
		padding: 8px 10px;
		border-radius: 8px;
		font-size: 12px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		-webkit-appearance: none;
		appearance: none;
	}

	.panel {
		background: #111113;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 12px;
		padding: 16px 18px;
	}
	.panel-header {
		display: flex; justify-content: space-between; align-items: center;
		margin-bottom: 12px;
	}
	.panel-header h2 { margin: 0; font-size: 14px; font-weight: 600; color: #e4e4e7; }
	.header-count { color: #52525b; font-size: 11px; font-weight: 500; }

	.ghost-btn {
		background: none; border: 1px solid rgba(255, 255, 255, 0.08);
		color: #a1a1aa; padding: 8px 14px; border-radius: 6px;
		font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit;
	}
	.ghost-btn:hover { color: #e4e4e7; background: rgba(255, 255, 255, 0.04); }
	.ghost-btn.small { padding: 4px 10px; font-size: 12px; }

	.primary-btn {
		background: #6366f1; color: #fff; border: none;
		padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 600;
		cursor: pointer; font-family: inherit;
	}
	.primary-btn:hover { background: #7c3aed; }

	.search {
		width: 100%;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
		padding: 8px 12px; border-radius: 6px; font-size: 13px;
		font-family: inherit; margin-bottom: 8px;
	}
	.search:focus { outline: none; border-color: rgba(99, 102, 241, 0.4); }

	.picker-list { max-height: 320px; overflow-y: auto; }
	.picker-row {
		display: flex; align-items: center; gap: 10px;
		padding: 8px 6px; cursor: pointer; width: 100%; text-align: left;
		background: none; border: none; border-bottom: 1px solid rgba(255, 255, 255, 0.03);
		font-family: inherit; color: inherit;
	}
	.picker-row:hover { background: rgba(255, 255, 255, 0.02); }
	.picker-row.active { background: rgba(99, 102, 241, 0.08); }
	.picker-info { min-width: 0; flex: 1; }
	.picker-name {
		font-size: 13px; color: #e4e4e7; font-weight: 500;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.picker-meta {
		display: flex; align-items: center; gap: 6px;
		font-size: 11px; color: #52525b; margin-top: 2px;
	}
	.badge {
		background: rgba(251, 191, 36, 0.12); color: #fbbf24;
		padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;
		text-transform: uppercase;
	}
	.badge.sm { padding: 0 4px; font-size: 9px; }
	.badge.sections-badge {
		background: rgba(99, 102, 241, 0.15); color: #a5b4fc;
	}
	.empty { text-align: center; color: #3f3f46; font-size: 13px; padding: 20px; margin: 0; }

	.selected-song { padding: 4px 0; }

	.cfg-grid { display: flex; flex-direction: column; gap: 14px; }
	.cfg-field { display: flex; flex-direction: column; gap: 6px; }
	.field-label-as-label { font-size: 12px; color: #71717a; font-weight: 500; }

	.number-row { display: flex; align-items: center; gap: 6px; }
	.num-btn {
		width: 28px; height: 28px; border-radius: 6px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #e4e4e7; font-size: 14px; font-weight: 600;
		cursor: pointer; font-family: inherit;
		display: flex; align-items: center; justify-content: center; padding: 0;
	}
	.num-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
	.num-btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.num-btn.tiny { width: 22px; height: 22px; font-size: 12px; }
	.num-input {
		width: 56px; height: 28px; text-align: center;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #e4e4e7; border-radius: 6px;
		font-size: 13px; font-weight: 600;
		font-variant-numeric: tabular-nums; font-family: inherit;
		-moz-appearance: textfield; appearance: textfield;
	}
	.num-input.wide { width: 80px; }
	.num-input::-webkit-outer-spin-button,
	.num-input::-webkit-inner-spin-button {
		-webkit-appearance: none; margin: 0;
	}
	.num-input:focus { outline: none; border-color: rgba(99, 102, 241, 0.4); }
	.num-suffix { color: #71717a; font-size: 12px; margin-left: 4px; }

	.actions-row { display: flex; gap: 10px; align-items: center; margin-top: 4px; }
	.cfg-hint { color: #52525b; font-size: 11px; margin: 0; }

	.timeline {
		position: relative;
		height: 36px;
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
		margin-bottom: 12px;
		overflow: hidden;
		touch-action: none;
	}
	.seg-block {
		position: absolute;
		top: 0; bottom: 0;
		display: flex; align-items: center; justify-content: center;
		font-size: 10px; color: rgba(255, 255, 255, 0.85);
		font-weight: 600;
		overflow: hidden;
		border-right: 1px solid rgba(0, 0, 0, 0.4);
	}
	.seg-block.active {
		box-shadow: inset 0 0 0 2px #818cf8;
	}
	.seg-label {
		padding: 0 6px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.handle {
		position: absolute;
		top: -2px; bottom: -2px;
		width: 8px;
		transform: translateX(-50%);
		background: rgba(255, 255, 255, 0.4);
		border: 1px solid #09090b;
		border-radius: 2px;
		cursor: ew-resize;
		padding: 0;
		touch-action: none;
		z-index: 2;
	}
	.handle:hover { background: #818cf8; }
	.handle.dragging { background: #818cf8; }

	.section-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.section-row {
		display: grid;
		grid-template-columns: 22px 1fr auto auto auto auto;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 6px;
	}
	.section-row.active {
		border-color: rgba(99, 102, 241, 0.4);
		background: rgba(99, 102, 241, 0.06);
	}
	.seg-index {
		color: #52525b; font-size: 11px; font-weight: 600;
		text-align: center; font-variant-numeric: tabular-nums;
	}
	.section-row.active .seg-index { color: #818cf8; }
	.seg-name-input {
		background: none; border: 1px solid transparent; color: #e4e4e7;
		padding: 4px 6px; font-size: 13px; font-family: inherit;
		border-radius: 4px; min-width: 0;
	}
	.seg-name-input:hover { border-color: rgba(255, 255, 255, 0.08); }
	.seg-name-input:focus {
		outline: none; border-color: rgba(99, 102, 241, 0.4);
		background: rgba(255, 255, 255, 0.03);
	}
	.seg-time {
		font-size: 11px; color: #71717a;
		font-variant-numeric: tabular-nums;
	}
	.seg-dur {
		font-size: 11px; color: #52525b;
		font-variant-numeric: tabular-nums;
	}
	.seg-loops {
		display: flex; align-items: center; gap: 4px;
	}
	.loop-val {
		font-size: 12px; font-weight: 600; color: #e4e4e7;
		font-variant-numeric: tabular-nums; min-width: 24px; text-align: center;
	}
	.row-btn {
		background: none; border: none; color: #3f3f46;
		padding: 4px; border-radius: 4px; cursor: pointer;
	}
	.row-btn:hover:not(:disabled) { color: #a1a1aa; background: rgba(255, 255, 255, 0.04); }
	.row-btn.danger:hover:not(:disabled) { color: #ef4444; background: rgba(239, 68, 68, 0.08); }
	.row-btn:disabled { opacity: 0.3; cursor: not-allowed; }

	@media (max-width: 640px) {
		.section-row {
			grid-template-columns: 22px 1fr auto auto auto;
		}
		.seg-dur { display: none; }
	}
</style>
