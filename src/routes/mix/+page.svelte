<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as store from '$lib/store.svelte';
	import type { VideoMeta, ClipMeta } from '$lib/store.svelte';

	type PoolSource = 'songs' | 'clips';
	type PoolMode = 'filters' | 'manual';
	type StartMode = 'trim-edges' | 'from-start' | 'random';
	type Phase = 'idle' | 'playing' | 'paused' | 'gap' | 'ended';
	type Item = { video: VideoMeta; clip: ClipMeta | null };

	const CONFIG_KEY = 'mix-config-v1';
	const CLIP_TYPES = ['move', 'pattern', 'styling', 'footwork', 'musicality'] as const;

	const knownCouples = [
		'Anthony', 'Cornel', 'Daniel', 'Emilien', 'Gero', 'Irakli',
		'Jes', 'Luis', 'Marcus', 'Melvin', 'Micka', 'Miguel', 'Ofir',
		'Victor', 'Favian',
	];

	// Pool selection
	let poolSource = $state<PoolSource>('songs');
	let poolMode = $state<PoolMode>('filters');
	let filterDance = $state('');
	let filterCategory = $state('');
	let filterCouples = $state<string[]>([]);
	let clipTypeFilters = $state<string[]>([]);
	let manualVideoIds = $state<string[]>([]);
	let manualClipIds = $state<string[]>([]);
	let showManualPicker = $state(false);
	let pickerSearch = $state('');

	// Config
	let segmentDuration = $state(45);
	let segmentVariance = $state(10);
	let startMode = $state<StartMode>('trim-edges');
	let skipEdgesSeconds = $state(15);
	let gapDuration = $state(0);
	let sessionCapMinutes = $state(0);
	let beepEnabled = $state(false);
	let playbackRate = $state(1);
	let repeatCount = $state(1);
	let showConfig = $state(true);

	const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const;

	// Player
	let phase = $state<Phase>('idle');
	let audioEl = $state<HTMLAudioElement | undefined>();
	let audioUrl = $state('');
	let currentVideo = $state<VideoMeta | null>(null);
	let currentClip = $state<ClipMeta | null>(null);
	let segmentStartOffset = $state(0);
	let segmentDurationActual = $state(0);
	let segmentElapsed = $state(0);
	let warningsFired = $state<number[]>([]);
	let playedIds = $state<string[]>([]);
	let lastPlayedId = $state<string | null>(null);
	let itemsPlayed = $state(0);
	let currentRepeat = $state(1);
	let sessionStartedAtMs = $state(0);
	let sessionElapsedSec = $state(0);
	let needsSeek = $state(false);
	let gapRemaining = $state(0);
	let audioCtx: AudioContext | null = null;
	let gapTimer: ReturnType<typeof setTimeout> | null = null;
	let gapTickTimer: ReturnType<typeof setInterval> | null = null;

	const videos = $derived(store.getVideos());
	const clips = $derived(store.getClips());

	const songPool = $derived.by(() => {
		if (poolMode === 'manual') {
			return videos.filter(v => manualVideoIds.includes(v.id));
		}
		let filtered = videos.filter(v => !v.hidden && !v.hiddenFromSearch);
		if (filterDance) filtered = filtered.filter(v => v.dance === filterDance);
		if (filterCategory) filtered = filtered.filter(v => v.category === filterCategory);
		if (filterCouples.length > 0) {
			filtered = filtered.filter(v => filterCouples.includes(v.lead));
		}
		return filtered;
	});

	const clipPool = $derived.by(() => {
		if (poolMode === 'manual') {
			return clips.filter(c => manualClipIds.includes(c.id));
		}
		const videoIndex = new Map(videos.map(v => [v.id, v]));
		let filtered = clips.filter(c => !c.hidden && !c.hiddenFromSearch);
		// Drop clips whose source video is gone or unplayable
		filtered = filtered.filter(c => videoIndex.has(c.videoId));
		if (filterDance) filtered = filtered.filter(c => c.dance === filterDance);
		if (clipTypeFilters.length > 0) filtered = filtered.filter(c => clipTypeFilters.includes(c.clipType));
		if (filterCouples.length > 0) {
			filtered = filtered.filter(c => filterCouples.includes(c.lead));
		}
		return filtered;
	});

	const poolCount = $derived(poolSource === 'songs' ? songPool.length : clipPool.length);
	const progressPct = $derived(
		segmentDurationActual > 0
			? Math.min(100, (segmentElapsed / segmentDurationActual) * 100)
			: 0
	);
	const remainingSec = $derived(Math.max(0, segmentDurationActual - segmentElapsed));

	onMount(() => {
		try {
			const raw = localStorage.getItem(CONFIG_KEY);
			if (!raw) return;
			const c = JSON.parse(raw);
			if (c.poolSource === 'songs' || c.poolSource === 'clips') poolSource = c.poolSource;
			if (c.poolMode === 'filters' || c.poolMode === 'manual') poolMode = c.poolMode;
			if (typeof c.filterDance === 'string') filterDance = c.filterDance;
			if (typeof c.filterCategory === 'string') filterCategory = c.filterCategory;
			if (Array.isArray(c.filterCouples)) filterCouples = c.filterCouples.filter((x: unknown) => typeof x === 'string');
			if (Array.isArray(c.clipTypeFilters)) clipTypeFilters = c.clipTypeFilters.filter((x: unknown) => typeof x === 'string');
			if (Array.isArray(c.manualVideoIds)) manualVideoIds = c.manualVideoIds.filter((x: unknown) => typeof x === 'string');
			if (Array.isArray(c.manualClipIds)) manualClipIds = c.manualClipIds.filter((x: unknown) => typeof x === 'string');
			if (typeof c.segmentDuration === 'number') segmentDuration = c.segmentDuration;
			if (typeof c.segmentVariance === 'number') segmentVariance = c.segmentVariance;
			if (c.startMode === 'trim-edges' || c.startMode === 'from-start' || c.startMode === 'random') startMode = c.startMode;
			else if (c.startMode === 'skip-intro') startMode = 'trim-edges'; // legacy migration
			if (typeof c.skipEdgesSeconds === 'number') skipEdgesSeconds = c.skipEdgesSeconds;
			else if (typeof c.skipIntroSeconds === 'number') skipEdgesSeconds = c.skipIntroSeconds; // legacy migration
			if (typeof c.gapDuration === 'number') gapDuration = c.gapDuration;
			if (typeof c.sessionCapMinutes === 'number') sessionCapMinutes = c.sessionCapMinutes;
			if (typeof c.beepEnabled === 'boolean') beepEnabled = c.beepEnabled;
			if (typeof c.playbackRate === 'number' && SPEEDS.includes(c.playbackRate as never)) playbackRate = c.playbackRate;
			if (typeof c.repeatCount === 'number') repeatCount = Math.max(1, Math.min(20, Math.floor(c.repeatCount)));
		} catch {
			// ignore
		}
	});

	$effect(() => {
		const c = {
			poolSource, poolMode, filterDance, filterCategory, filterCouples,
			clipTypeFilters, manualVideoIds, manualClipIds,
			segmentDuration, segmentVariance, startMode, skipEdgesSeconds,
			gapDuration, sessionCapMinutes, beepEnabled, playbackRate, repeatCount,
		};
		try {
			localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
		} catch {
			// ignore
		}
	});

	function pickNextItem(): Item | null {
		if (poolSource === 'songs') {
			const pool = songPool;
			if (pool.length === 0) return null;
			let available = pool.filter(v => !playedIds.includes(v.id));
			if (available.length === 0) {
				playedIds = [];
				available = pool.filter(v => v.id !== lastPlayedId);
				if (available.length === 0) available = pool;
			}
			const v = available[Math.floor(Math.random() * available.length)];
			return { video: v, clip: null };
		}
		const pool = clipPool;
		if (pool.length === 0) return null;
		let available = pool.filter(c => !playedIds.includes(c.id));
		if (available.length === 0) {
			playedIds = [];
			available = pool.filter(c => c.id !== lastPlayedId);
			if (available.length === 0) available = pool;
		}
		const clip = available[Math.floor(Math.random() * available.length)];
		const video = videos.find(v => v.id === clip.videoId);
		if (!video) return null;
		return { video, clip };
	}

	function setupSegment(item: Item): { start: number; duration: number } {
		if (item.clip) {
			const len = Math.max(2, item.clip.endTime - item.clip.startTime);
			return { start: item.clip.startTime, duration: len };
		}
		const videoLen = item.video.duration;
		const variance = segmentVariance > 0 ? (Math.random() * 2 - 1) * segmentVariance : 0;
		let dur = Math.max(5, segmentDuration + variance);

		const isTrim = startMode === 'trim-edges';
		const minWindow = 10;
		// Same value trims both ends, capped so a window of at least minWindow remains
		const maxTrim = Math.max(0, (videoLen - minWindow) / 2);
		const trim = isTrim ? Math.min(skipEdgesSeconds, maxTrim) : 0;
		const playable = Math.max(minWindow, videoLen - trim * 2);

		dur = Math.min(dur, playable);

		let start = 0;
		if (startMode === 'trim-edges') {
			const maxStart = Math.max(trim, videoLen - trim - dur);
			start = trim + Math.random() * Math.max(0, maxStart - trim);
		} else if (startMode === 'random') {
			const maxStart = Math.max(0, videoLen - dur);
			start = Math.random() * maxStart;
		}
		return { start, duration: dur };
	}

	function ensureAudioCtx(): AudioContext | null {
		try {
			if (!audioCtx || audioCtx.state === 'closed') {
				const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
				audioCtx = new Ctor();
			}
			if (audioCtx.state === 'suspended') audioCtx.resume();
			return audioCtx;
		} catch {
			return null;
		}
	}

	function playBeep(freq: number) {
		if (!beepEnabled) return;
		const ctx = ensureAudioCtx();
		if (!ctx) return;
		try {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.type = 'square';
			osc.frequency.value = freq;
			const t = ctx.currentTime + 0.005;
			gain.gain.setValueAtTime(0, t);
			gain.gain.linearRampToValueAtTime(0.6, t + 0.01);
			gain.gain.setValueAtTime(0.6, t + 0.18);
			gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
			osc.start(t);
			osc.stop(t + 0.26);
		} catch {
			// ignore
		}
	}

	function clearGapTimers() {
		if (gapTimer) { clearTimeout(gapTimer); gapTimer = null; }
		if (gapTickTimer) { clearInterval(gapTickTimer); gapTickTimer = null; }
	}

	function startSession() {
		if (poolCount === 0 || !audioEl) return;
		ensureAudioCtx();
		playedIds = [];
		lastPlayedId = null;
		itemsPlayed = 0;
		sessionStartedAtMs = Date.now();
		sessionElapsedSec = 0;
		phase = 'playing';
		loadNextItem();
	}

	function loadNextItem() {
		if (!audioEl) return;
		if (sessionCapMinutes > 0) {
			const elapsed = (Date.now() - sessionStartedAtMs) / 1000;
			if (elapsed >= sessionCapMinutes * 60) {
				endSession();
				return;
			}
		}

		const next = pickNextItem();
		if (!next) { endSession(); return; }

		const url = store.getCdnUrlForVideo(next.video.id);
		if (!url) { advanceToNext(); return; }

		currentVideo = next.video;
		currentClip = next.clip;
		const itemId = next.clip ? next.clip.id : next.video.id;
		playedIds = [...playedIds, itemId];
		lastPlayedId = itemId;

		const { start, duration } = setupSegment(next);
		segmentStartOffset = start;
		segmentDurationActual = duration;
		segmentElapsed = 0;
		warningsFired = [];
		currentRepeat = 1;
		needsSeek = true;
		audioUrl = url;
		itemsPlayed += 1;
	}

	function replayCurrent() {
		if (!audioEl) return;
		currentRepeat += 1;
		segmentElapsed = 0;
		warningsFired = [];
		audioEl.currentTime = segmentStartOffset;
		audioEl.play().catch(() => {});
	}

	function handleAudioLoaded() {
		if (!audioEl || !needsSeek) return;
		needsSeek = false;
		audioEl.currentTime = segmentStartOffset;
		audioEl.playbackRate = playbackRate;
		audioEl.play().catch(() => {});
	}

	function setSpeed(s: number) {
		playbackRate = s;
		if (audioEl) audioEl.playbackRate = s;
	}

	function seekSegment(e: MouseEvent) {
		if (!audioEl || phase === 'idle' || phase === 'ended' || segmentDurationActual <= 0) return;
		const bar = e.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		const newElapsed = pct * segmentDurationActual;
		audioEl.currentTime = segmentStartOffset + newElapsed;
		segmentElapsed = newElapsed;
		const remaining = segmentDurationActual - newElapsed;
		warningsFired = [3, 2, 1].filter(t => remaining <= t);
	}

	function handleTimeUpdate() {
		if (!audioEl || phase !== 'playing' || needsSeek) return;
		const elapsed = audioEl.currentTime - segmentStartOffset;
		segmentElapsed = Math.max(0, elapsed);
		sessionElapsedSec = (Date.now() - sessionStartedAtMs) / 1000;

		const remaining = segmentDurationActual - elapsed;

		if (beepEnabled) {
			for (const t of [3, 2, 1]) {
				if (remaining <= t && remaining > t - 1 && !warningsFired.includes(t)) {
					warningsFired = [...warningsFired, t];
					playBeep(880 + (3 - t) * 110);
				}
			}
		}

		if (elapsed >= segmentDurationActual) {
			advanceToNext();
		}
	}

	function handleAudioEnded() {
		if (phase === 'playing' && !needsSeek) advanceToNext();
	}

	function advanceToNext() {
		if (!audioEl) return;
		if (currentRepeat < repeatCount) {
			replayCurrent();
			return;
		}
		if (gapDuration > 0) {
			phase = 'gap';
			audioEl.pause();
			gapRemaining = gapDuration;
			gapTickTimer = setInterval(() => {
				gapRemaining = Math.max(0, gapRemaining - 0.1);
			}, 100);
			gapTimer = setTimeout(() => {
				clearGapTimers();
				if (phase === 'gap') {
					phase = 'playing';
					loadNextItem();
				}
			}, gapDuration * 1000);
		} else {
			loadNextItem();
		}
	}

	function togglePause() {
		if (!audioEl) return;
		if (phase === 'playing') {
			audioEl.pause();
			phase = 'paused';
		} else if (phase === 'paused') {
			phase = 'playing';
			audioEl.play().catch(() => {});
		}
	}

	function skipCurrent() {
		if (phase === 'gap') {
			clearGapTimers();
			phase = 'playing';
			loadNextItem();
			return;
		}
		if (phase === 'playing' || phase === 'paused') {
			phase = 'playing';
			loadNextItem();
		}
	}

	function endSession() {
		clearGapTimers();
		if (audioEl) audioEl.pause();
		phase = 'ended';
	}

	function resetToIdle() {
		clearGapTimers();
		if (audioEl) audioEl.pause();
		audioUrl = '';
		currentVideo = null;
		currentClip = null;
		segmentElapsed = 0;
		segmentDurationActual = 0;
		phase = 'idle';
	}

	function toggleCouple(name: string) {
		filterCouples = filterCouples.includes(name)
			? filterCouples.filter(c => c !== name)
			: [...filterCouples, name];
	}

	function toggleManualVideo(id: string) {
		manualVideoIds = manualVideoIds.includes(id)
			? manualVideoIds.filter(v => v !== id)
			: [...manualVideoIds, id];
	}

	function toggleManualClip(id: string) {
		manualClipIds = manualClipIds.includes(id)
			? manualClipIds.filter(c => c !== id)
			: [...manualClipIds, id];
	}

	function toggleClipType(t: string) {
		clipTypeFilters = clipTypeFilters.includes(t)
			? clipTypeFilters.filter(x => x !== t)
			: [...clipTypeFilters, t];
	}

	function clearFilters() {
		filterDance = '';
		filterCategory = '';
		filterCouples = [];
		clipTypeFilters = [];
	}

	function formatTime(s: number): string {
		if (!isFinite(s) || s < 0) s = 0;
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	const pickerVideos = $derived(
		[...videos]
			.filter(v => {
				if (!pickerSearch) return true;
				const q = pickerSearch.toLowerCase();
				return v.name.toLowerCase().includes(q)
					|| v.lead.toLowerCase().includes(q)
					|| v.follow.toLowerCase().includes(q)
					|| (v.dance ?? '').toLowerCase().includes(q);
			})
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	const pickerClips = $derived(
		[...clips]
			.filter(c => {
				if (!pickerSearch) return true;
				const q = pickerSearch.toLowerCase();
				return c.label.toLowerCase().includes(q)
					|| c.videoName.toLowerCase().includes(q)
					|| c.clipType.toLowerCase().includes(q)
					|| c.tags.some(t => t.toLowerCase().includes(q))
					|| c.lead.toLowerCase().includes(q)
					|| c.follow.toLowerCase().includes(q);
			})
			.sort((a, b) => a.label.localeCompare(b.label))
	);

	const playerActive = $derived(phase === 'playing' || phase === 'paused' || phase === 'gap');

	onDestroy(() => {
		clearGapTimers();
		if (audioEl) audioEl.pause();
		if (audioCtx) {
			audioCtx.close().catch(() => {});
			audioCtx = null;
		}
	});
</script>

<audio
	bind:this={audioEl}
	src={audioUrl}
	preload="auto"
	onloadedmetadata={handleAudioLoaded}
	ontimeupdate={handleTimeUpdate}
	onended={handleAudioEnded}
></audio>

<div class="page">
	<header class="hero">
		<h1>Jack &amp; Jill Mix</h1>
		<p class="sub">Random song, random moment, short segments. Train musical adaptation.</p>
	</header>

	<!-- Player card -->
	<section class="player-card" class:active={playerActive}>
		{#if phase === 'idle'}
			<div class="idle">
				<div class="pool-summary">
					<span class="count">{poolCount}</span>
					<span class="count-label">
						{poolSource === 'clips' ? (poolCount === 1 ? 'clip' : 'clips') : (poolCount === 1 ? 'song' : 'songs')} in pool
					</span>
				</div>
				<button
					class="start-btn"
					onclick={startSession}
					disabled={poolCount === 0}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
						<polygon points="5 3 19 12 5 21 5 3" />
					</svg>
					Start Mix
				</button>
				{#if poolCount === 0}
					<p class="hint">Pick some {poolSource === 'clips' ? 'clips' : 'songs'} below to begin.</p>
				{:else if poolSource === 'clips'}
					<p class="hint">Plays each clip start to end · random order</p>
				{:else}
					<p class="hint">
						{segmentDuration}s{segmentVariance > 0 ? ` ±${segmentVariance}s` : ''} segments ·
						{startMode === 'trim-edges' ? `random spot, trim ${skipEdgesSeconds}s from each edge` :
						 startMode === 'from-start' ? 'from start' : 'random spot in song'}
					</p>
				{/if}
			</div>
		{:else if phase === 'ended'}
			<div class="ended">
				<h2>Session complete</h2>
				<div class="session-stats">
					<div><strong>{itemsPlayed}</strong> {poolSource === 'clips' ? (itemsPlayed === 1 ? 'clip' : 'clips') : (itemsPlayed === 1 ? 'song' : 'songs')}</div>
					<div><strong>{formatTime(sessionElapsedSec)}</strong> elapsed</div>
				</div>
				<div class="ended-actions">
					<button class="start-btn" onclick={startSession}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
							<polygon points="5 3 19 12 5 21 5 3" />
						</svg>
						Go again
					</button>
					<button class="ghost-btn" onclick={resetToIdle}>Done</button>
				</div>
			</div>
		{:else}
			<div class="now-playing">
				<div class="now-header">
					<div class="now-title">
						<div class="song-name">{currentClip?.label ?? currentVideo?.name ?? ''}</div>
						<div class="song-meta">
							{#if currentClip}
								<span class="badge">{currentClip.clipType}</span>
								<span class="src-name">from {currentVideo?.name ?? ''}</span>
							{:else}
								{#if currentVideo?.lead}{currentVideo.lead}{/if}{#if currentVideo?.follow} &amp; {currentVideo.follow}{/if}
								{#if currentVideo?.dance}<span class="badge">{currentVideo.dance}</span>{/if}
							{/if}
						</div>
					</div>
					<button class="icon-btn" onclick={endSession} title="Stop session">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
							<rect x="5" y="5" width="14" height="14" rx="1" />
						</svg>
					</button>
				</div>

				<div class="countdown">
					{#if phase === 'gap'}
						<div class="gap-msg">Next in {Math.ceil(gapRemaining)}s</div>
					{:else}
						<div class="time-left" class:warn={remainingSec <= 3 && phase === 'playing'}>
							{Math.ceil(remainingSec)}s
						</div>
					{/if}
				</div>

				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="progress-bar seekable" onclick={seekSegment} title="Click to seek within this segment">
					<div class="progress-fill" style="width: {progressPct}%"></div>
				</div>

				<div class="controls">
					<button class="ctrl-btn primary" onclick={togglePause} disabled={phase === 'gap'}>
						{#if phase === 'playing'}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
							Pause
						{:else}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
							Resume
						{/if}
					</button>
					<button class="ctrl-btn" onclick={skipCurrent}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="5 4 15 12 5 20" /><line x1="19" y1="4" x2="19" y2="20" /></svg>
						Next
					</button>
					<select class="speed-select" value={playbackRate} onchange={(e) => setSpeed(Number((e.target as HTMLSelectElement).value))}>
						{#each SPEEDS as s}
							<option value={s}>{s}×</option>
						{/each}
					</select>
				</div>

				<div class="session-meta">
					<span>{poolSource === 'clips' ? 'Clip' : 'Song'} {itemsPlayed}</span>
					{#if repeatCount > 1}
						<span class="dot"></span>
						<span>loop {currentRepeat}/{repeatCount}</span>
					{/if}
					<span class="dot"></span>
					<span>{formatTime(sessionElapsedSec)} elapsed</span>
					{#if sessionCapMinutes > 0}
						<span class="dot"></span>
						<span>{sessionCapMinutes}m cap</span>
					{/if}
				</div>
			</div>
		{/if}
	</section>

	<!-- Pool source -->
	<section class="panel">
		<div class="panel-header">
			<h2>Pool</h2>
			<div class="mode-toggle">
				<button class:active={poolSource === 'songs'} onclick={() => poolSource = 'songs'}>Songs</button>
				<button class:active={poolSource === 'clips'} onclick={() => poolSource = 'clips'}>Clips</button>
			</div>
		</div>

		<div class="sub-header">
			<div class="mode-toggle">
				<button class:active={poolMode === 'filters'} onclick={() => poolMode = 'filters'}>Filters</button>
				<button class:active={poolMode === 'manual'} onclick={() => poolMode = 'manual'}>Hand-pick</button>
			</div>
		</div>

		{#if poolMode === 'filters'}
			<div class="filter-row">
				<select bind:value={filterDance} class="select">
					<option value="">Any dance</option>
					<option value="bachata">Bachata</option>
					<option value="salsa">Salsa</option>
				</select>
				{#if poolSource === 'songs'}
					<select bind:value={filterCategory} class="select">
						<option value="">Any category</option>
						<option value="demo">Demo</option>
						<option value="jack-and-jill">Jack &amp; Jill</option>
						<option value="workshop">Workshop</option>
						<option value="social">Social</option>
					</select>
				{/if}
				{#if filterDance || filterCategory || filterCouples.length > 0 || clipTypeFilters.length > 0}
					<button class="ghost-btn small" onclick={clearFilters}>Clear</button>
				{/if}
			</div>

			{#if poolSource === 'clips'}
				<div class="chip-row">
					{#each CLIP_TYPES as t}
						<button
							class="chip"
							class:on={clipTypeFilters.includes(t)}
							onclick={() => toggleClipType(t)}
						>
							{t}
						</button>
					{/each}
				</div>
			{/if}

			<div class="chip-row">
				{#each knownCouples as name}
					<button
						class="chip"
						class:on={filterCouples.includes(name)}
						onclick={() => toggleCouple(name)}
					>
						{name}
					</button>
				{/each}
			</div>
		{:else if poolSource === 'songs'}
			<div class="manual">
				<div class="manual-summary">
					<span><strong>{manualVideoIds.length}</strong> selected</span>
					<button class="ghost-btn small" onclick={() => showManualPicker = !showManualPicker}>
						{showManualPicker ? 'Hide picker' : 'Pick songs'}
					</button>
					{#if manualVideoIds.length > 0}
						<button class="ghost-btn small" onclick={() => manualVideoIds = []}>Clear</button>
					{/if}
				</div>
				{#if showManualPicker}
					<input
						type="text"
						class="search"
						placeholder="Search videos..."
						bind:value={pickerSearch}
					/>
					<div class="picker-list">
						{#each pickerVideos as v (v.id)}
							<label class="picker-row">
								<input
									type="checkbox"
									checked={manualVideoIds.includes(v.id)}
									onchange={() => toggleManualVideo(v.id)}
								/>
								<div class="picker-info">
									<div class="picker-name">{v.name}</div>
									<div class="picker-meta">
										{#if v.lead}{v.lead}{#if v.follow} &amp; {v.follow}{/if}{/if}
										{#if v.dance}<span class="badge sm">{v.dance}</span>{/if}
										{#if v.duration}<span>{formatTime(v.duration)}</span>{/if}
									</div>
								</div>
							</label>
						{/each}
						{#if pickerVideos.length === 0}
							<p class="empty">No videos found.</p>
						{/if}
					</div>
				{/if}
			</div>
		{:else}
			<div class="manual">
				<div class="manual-summary">
					<span><strong>{manualClipIds.length}</strong> selected</span>
					<button class="ghost-btn small" onclick={() => showManualPicker = !showManualPicker}>
						{showManualPicker ? 'Hide picker' : 'Pick clips'}
					</button>
					{#if manualClipIds.length > 0}
						<button class="ghost-btn small" onclick={() => manualClipIds = []}>Clear</button>
					{/if}
				</div>
				{#if showManualPicker}
					<input
						type="text"
						class="search"
						placeholder="Search clips..."
						bind:value={pickerSearch}
					/>
					<div class="picker-list">
						{#each pickerClips as c (c.id)}
							<label class="picker-row">
								<input
									type="checkbox"
									checked={manualClipIds.includes(c.id)}
									onchange={() => toggleManualClip(c.id)}
								/>
								<div class="picker-info">
									<div class="picker-name">{c.label}</div>
									<div class="picker-meta">
										<span class="badge sm">{c.clipType}</span>
										<span>{formatTime(c.endTime - c.startTime)}</span>
										<span class="src-name">{c.videoName}</span>
									</div>
								</div>
							</label>
						{/each}
						{#if pickerClips.length === 0}
							<p class="empty">No clips found.</p>
						{/if}
					</div>
				{/if}
			</div>
		{/if}

		<div class="pool-count">
			<span class="count-pill" class:empty={poolCount === 0}>
				{poolCount} {poolSource === 'clips' ? (poolCount === 1 ? 'clip' : 'clips') : (poolCount === 1 ? 'song' : 'songs')} in pool
			</span>
		</div>
	</section>

	<!-- Config -->
	<section class="panel">
		<div class="panel-header">
			<button class="collapse-btn" onclick={() => showConfig = !showConfig}>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" style="transform: rotate({showConfig ? 90 : 0}deg); transition: transform 0.15s;">
					<polyline points="9 6 15 12 9 18" />
				</svg>
				<h2>Settings</h2>
			</button>
		</div>

		{#if showConfig}
			<div class="cfg-grid">
				{#if poolSource === 'songs'}
					<div class="cfg-field">
						<label for="seg-dur">Segment duration</label>
						<div class="slider-row">
							<input
								id="seg-dur"
								type="range"
								min="15"
								max="120"
								step="5"
								bind:value={segmentDuration}
							/>
							<span class="slider-val">{segmentDuration}s</span>
						</div>
					</div>

					<div class="cfg-field">
						<div class="field-label">Variance</div>
						<div class="option-row">
							{#each [0, 5, 10, 15] as v}
								<button
									class="option"
									class:on={segmentVariance === v}
									onclick={() => segmentVariance = v}
								>
									{v === 0 ? 'None' : `±${v}s`}
								</button>
							{/each}
						</div>
					</div>

					<div class="cfg-field">
						<div class="field-label">Start of song</div>
						<div class="option-row">
							<button class="option" class:on={startMode === 'trim-edges'} onclick={() => startMode = 'trim-edges'}>
								Trim edges
							</button>
							<button class="option" class:on={startMode === 'from-start'} onclick={() => startMode = 'from-start'}>
								From start
							</button>
							<button class="option" class:on={startMode === 'random'} onclick={() => startMode = 'random'}>
								Random
							</button>
						</div>
						{#if startMode === 'trim-edges'}
							<div class="slider-row small">
								<input
									type="range"
									min="0"
									max="60"
									step="5"
									bind:value={skipEdgesSeconds}
								/>
								<span class="slider-val">trim {skipEdgesSeconds}s</span>
							</div>
							<div class="cfg-hint">Random moment, but never within {skipEdgesSeconds}s of the start or end.</div>
						{:else if startMode === 'from-start'}
							<div class="cfg-hint">Always begin at 0:00 (same opening every song).</div>
						{:else}
							<div class="cfg-hint">Anywhere in the song, including the intro and outro.</div>
						{/if}
					</div>
				{:else}
					<div class="cfg-note">
						Clip duration is taken from each clip's in/out points — segment timing settings don't apply.
					</div>
				{/if}

				<div class="cfg-field">
					<label for="repeat-count" class="field-label-as-label">Repeat each {poolSource === 'clips' ? 'clip' : 'song'}</label>
					<div class="number-row">
						<button
							class="num-btn"
							onclick={() => repeatCount = Math.max(1, repeatCount - 1)}
							disabled={repeatCount <= 1}
							aria-label="Decrease"
						>−</button>
						<input
							id="repeat-count"
							type="number"
							class="num-input"
							min="1"
							max="20"
							step="1"
							value={repeatCount}
							oninput={(e) => {
								const v = parseInt((e.target as HTMLInputElement).value, 10);
								if (!isNaN(v)) repeatCount = Math.max(1, Math.min(20, v));
							}}
						/>
						<button
							class="num-btn"
							onclick={() => repeatCount = Math.min(20, repeatCount + 1)}
							disabled={repeatCount >= 20}
							aria-label="Increase"
						>+</button>
						<span class="num-suffix">{repeatCount === 1 ? 'once (no repeat)' : `${repeatCount}× before next`}</span>
					</div>
				</div>

				<div class="cfg-field">
					<div class="field-label">Gap between {poolSource === 'clips' ? 'clips' : 'songs'}</div>
					<div class="option-row">
						{#each [0, 1, 3, 5] as g}
							<button
								class="option"
								class:on={gapDuration === g}
								onclick={() => gapDuration = g}
							>
								{g === 0 ? 'None' : `${g}s`}
							</button>
						{/each}
					</div>
				</div>

				<div class="cfg-field">
					<div class="field-label">Session cap</div>
					<div class="option-row">
						{#each [0, 5, 10, 15, 30] as m}
							<button
								class="option"
								class:on={sessionCapMinutes === m}
								onclick={() => sessionCapMinutes = m}
							>
								{m === 0 ? 'None' : `${m}m`}
							</button>
						{/each}
					</div>
				</div>

				<div class="cfg-field">
					<label class="check-label">
						<input type="checkbox" bind:checked={beepEnabled} />
						<span>Warning beep (T-3s countdown)</span>
					</label>
				</div>
			</div>
		{/if}
	</section>

	<div class="foot-note">
		Audio-only playback — video track is ignored to save CPU. Saved across reloads.
	</div>
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
	.hero .sub {
		margin: 0;
		color: #71717a;
		font-size: 13px;
	}

	/* Player */
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
		gap: 14px;
		padding: 20px 0;
	}

	.pool-summary {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.pool-summary .count {
		font-size: 36px;
		font-weight: 700;
		color: #e4e4e7;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.03em;
	}
	.pool-summary .count-label {
		color: #71717a;
		font-size: 13px;
	}

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
		transition: background 0.15s, transform 0.05s;
	}
	.start-btn:hover:not(:disabled) { background: #7c3aed; }
	.start-btn:active:not(:disabled) { transform: scale(0.98); }
	.start-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.hint {
		margin: 4px 0 0;
		color: #52525b;
		font-size: 12px;
	}

	/* Ended */
	.ended {
		text-align: center;
		padding: 20px 0;
	}
	.ended h2 {
		margin: 0 0 16px;
		font-size: 18px;
		font-weight: 600;
	}
	.session-stats {
		display: flex;
		gap: 32px;
		justify-content: center;
		margin-bottom: 20px;
		color: #71717a;
		font-size: 13px;
	}
	.session-stats strong {
		display: block;
		color: #e4e4e7;
		font-size: 22px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.ended-actions {
		display: flex;
		gap: 10px;
		justify-content: center;
	}

	/* Now playing */
	.now-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 16px;
	}
	.now-title { min-width: 0; }
	.song-name {
		font-size: 18px;
		font-weight: 700;
		color: #e4e4e7;
		letter-spacing: -0.01em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.song-meta {
		margin-top: 4px;
		color: #71717a;
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.badge {
		background: rgba(251, 191, 36, 0.12);
		color: #fbbf24;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	.badge.sm { padding: 0 4px; font-size: 9px; }
	.src-name {
		color: #52525b;
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 220px;
	}
	.sub-header {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 10px;
	}
	.cfg-note {
		color: #71717a;
		font-size: 12px;
		padding: 8px 12px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 6px;
	}
	.cfg-hint {
		color: #52525b;
		font-size: 11px;
		margin-top: 4px;
	}
	.field-label-as-label {
		font-size: 12px;
		color: #71717a;
		font-weight: 500;
	}
	.number-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.num-btn {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}
	.num-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.08);
	}
	.num-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.num-input {
		width: 52px;
		height: 28px;
		text-align: center;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		font-family: inherit;
		-moz-appearance: textfield;
		appearance: textfield;
	}
	.num-input::-webkit-outer-spin-button,
	.num-input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	.num-input:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
	}
	.num-suffix {
		color: #71717a;
		font-size: 12px;
		margin-left: 4px;
	}

	.countdown {
		display: flex;
		justify-content: center;
		padding: 20px 0;
	}
	.time-left {
		font-size: 64px;
		font-weight: 700;
		color: #e4e4e7;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.04em;
		line-height: 1;
		transition: color 0.2s;
	}
	.time-left.warn { color: #f59e0b; }
	.gap-msg {
		font-size: 22px;
		color: #a1a1aa;
		font-weight: 500;
	}

	.progress-bar {
		height: 6px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 16px;
	}
	.progress-bar.seekable {
		cursor: pointer;
	}
	.progress-bar.seekable:hover {
		height: 8px;
	}
	.progress-fill {
		height: 100%;
		background: #6366f1;
		transition: width 0.15s linear;
	}
	.speed-select {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
		padding: 9px 12px;
		border-radius: 8px;
		font-size: 12px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		-webkit-appearance: none;
		appearance: none;
	}
	.speed-select:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
	}

	.controls {
		display: flex;
		gap: 8px;
		justify-content: center;
		margin-bottom: 16px;
	}
	.ctrl-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		background: rgba(255, 255, 255, 0.04);
		color: #e4e4e7;
		border: 1px solid rgba(255, 255, 255, 0.06);
		padding: 10px 20px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
		transition: background 0.15s, border-color 0.15s;
	}
	.ctrl-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.08);
		border-color: rgba(255, 255, 255, 0.12);
	}
	.ctrl-btn.primary {
		background: #6366f1;
		border-color: #6366f1;
		color: #fff;
	}
	.ctrl-btn.primary:hover:not(:disabled) { background: #7c3aed; border-color: #7c3aed; }
	.ctrl-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.icon-btn {
		background: none;
		border: none;
		color: #52525b;
		padding: 6px;
		border-radius: 6px;
		cursor: pointer;
		display: flex;
		align-items: center;
		transition: color 0.15s, background 0.15s;
	}
	.icon-btn:hover { color: #e4e4e7; background: rgba(255, 255, 255, 0.04); }

	.session-meta {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: #52525b;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}
	.dot {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: #3f3f46;
	}

	/* Panels */
	.panel {
		background: #111113;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 12px;
		padding: 16px 18px;
	}
	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 12px;
	}
	.panel-header h2 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		color: #e4e4e7;
	}

	.collapse-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		background: none;
		border: none;
		color: #a1a1aa;
		cursor: pointer;
		padding: 0;
		font-family: inherit;
	}
	.collapse-btn:hover { color: #e4e4e7; }

	.mode-toggle {
		display: flex;
		gap: 0;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 7px;
		padding: 2px;
	}
	.mode-toggle button {
		background: none;
		border: none;
		color: #71717a;
		padding: 5px 12px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		border-radius: 5px;
		font-family: inherit;
		transition: all 0.15s;
	}
	.mode-toggle button.active {
		background: rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
	}

	.filter-row {
		display: flex;
		gap: 8px;
		margin-bottom: 10px;
		flex-wrap: wrap;
	}
	.select {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
		padding: 7px 10px;
		border-radius: 6px;
		font-size: 13px;
		font-family: inherit;
		cursor: pointer;
		-webkit-appearance: none;
		appearance: none;
	}
	.select:focus { outline: none; border-color: rgba(99, 102, 241, 0.4); }

	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 6px;
	}
	.chip {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #a1a1aa;
		padding: 5px 10px;
		border-radius: 14px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: inherit;
		transition: all 0.15s;
	}
	.chip:hover { color: #e4e4e7; border-color: rgba(255, 255, 255, 0.12); }
	.chip.on {
		background: rgba(99, 102, 241, 0.15);
		border-color: rgba(99, 102, 241, 0.4);
		color: #a5b4fc;
	}

	.manual-summary {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 10px;
	}
	.manual-summary span {
		color: #a1a1aa;
		font-size: 13px;
	}
	.manual-summary strong { color: #e4e4e7; }

	.search {
		width: 100%;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
		padding: 8px 12px;
		border-radius: 6px;
		font-size: 13px;
		font-family: inherit;
		margin-bottom: 8px;
	}
	.search:focus { outline: none; border-color: rgba(99, 102, 241, 0.4); }
	.search::placeholder { color: #3f3f46; }

	.picker-list {
		max-height: 320px;
		overflow-y: auto;
		border-top: 1px solid rgba(255, 255, 255, 0.04);
	}
	.picker-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 6px;
		cursor: pointer;
		border-bottom: 1px solid rgba(255, 255, 255, 0.03);
	}
	.picker-row:hover { background: rgba(255, 255, 255, 0.02); }
	.picker-row input[type='checkbox'] {
		accent-color: #6366f1;
		cursor: pointer;
	}
	.picker-info { min-width: 0; flex: 1; }
	.picker-name {
		font-size: 13px;
		color: #e4e4e7;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.picker-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: #52525b;
		margin-top: 2px;
	}

	.empty {
		text-align: center;
		color: #3f3f46;
		font-size: 13px;
		padding: 20px;
		margin: 0;
	}

	.pool-count {
		display: flex;
		justify-content: flex-end;
		margin-top: 12px;
	}
	.count-pill {
		background: rgba(99, 102, 241, 0.1);
		color: #a5b4fc;
		font-size: 12px;
		font-weight: 600;
		padding: 4px 10px;
		border-radius: 10px;
	}
	.count-pill.empty {
		background: rgba(239, 68, 68, 0.1);
		color: #f87171;
	}

	/* Config */
	.cfg-grid {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.cfg-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.cfg-field > label,
	.cfg-field > .field-label {
		font-size: 12px;
		color: #71717a;
		font-weight: 500;
	}
	.slider-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.slider-row.small { margin-top: 6px; }
	.slider-row input[type='range'] {
		flex: 1;
		accent-color: #6366f1;
	}
	.slider-val {
		font-size: 13px;
		color: #e4e4e7;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		min-width: 52px;
	}

	.option-row {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.option {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #a1a1aa;
		padding: 6px 12px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: inherit;
		transition: all 0.15s;
	}
	.option:hover { color: #e4e4e7; }
	.option.on {
		background: rgba(99, 102, 241, 0.15);
		border-color: rgba(99, 102, 241, 0.4);
		color: #a5b4fc;
	}

	.check-label {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		color: #a1a1aa;
		font-size: 13px;
	}
	.check-label input {
		accent-color: #6366f1;
		cursor: pointer;
	}

	.ghost-btn {
		background: none;
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #a1a1aa;
		padding: 8px 14px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		font-family: inherit;
	}
	.ghost-btn:hover { color: #e4e4e7; background: rgba(255, 255, 255, 0.04); }
	.ghost-btn.small { padding: 4px 10px; font-size: 12px; }

	.foot-note {
		text-align: center;
		color: #3f3f46;
		font-size: 11px;
		padding: 12px 0;
	}

	@media (max-width: 640px) {
		.time-left { font-size: 56px; }
		.panel { padding: 14px; }
	}
</style>
