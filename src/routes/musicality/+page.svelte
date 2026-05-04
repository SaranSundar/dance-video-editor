<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as store from '$lib/store.svelte';
	import type { VideoMeta, MusicalityClip } from '$lib/store.svelte';

	type Phase = 'idle' | 'lead-in' | 'active' | 'lead-out' | 'paused' | 'ended';

	const CONFIG_KEY = 'musicality-config-v1';
	const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const;

	let selectedVideoId = $state<string | null>(null);
	let pickerSearch = $state('');
	let showPicker = $state(false);
	let playbackRate = $state(1);

	// Offline mode + audio cache stats
	let offlineMode = $state(false);
	let cachedSongs = $state(0);
	let downloadingAll = $state(false);
	let downloadAllProgress = $state(0);
	let downloadAllTotal = $state(0);
	let storageEstimateMb = $state<number | null>(null);

	let defaultBufferBefore = $state(5);
	let defaultBufferAfter = $state(5);
	let defaultLoops = $state(1);
	let overrideExisting = $state(false);

	// Editor draft
	let draftStart = $state<number | null>(null);
	let draftEnd = $state<number | null>(null);
	let draftName = $state('');

	// Pre-fetched audio cache: videoId -> blob URL
	const audioCache = new Map<string, string>();
	let prefetchDone = $state(0);
	let prefetchTotal = $state(0);
	let prefetchInProgress = $state(false);

	// Editor audio (for scrubbing the song while marking clips)
	let editorAudioEl = $state<HTMLAudioElement | undefined>();
	let editorAudioUrl = $state('');
	let editorTime = $state(0);
	let editorPlaying = $state(false);
	let editorDuration = $state(0);

	// Practice player
	let playerAudioEl = $state<HTMLAudioElement | undefined>();
	let playerAudioUrl = $state('');
	let phase = $state<Phase>('idle');
	let resumePhase = $state<Phase>('lead-in');
	let currentClipIdx = $state(0);
	let currentLoop = $state(1);
	let needsSeek = $state(false);
	let pendingSeekTo = $state(0);
	let segElapsed = $state(0);

	const videos = $derived(store.getVideos());
	const selectedVideo = $derived<VideoMeta | null>(
		selectedVideoId ? videos.find(v => v.id === selectedVideoId) ?? null : null
	);
	const allMusicality = $derived(store.getMusicality());
	const clips = $derived<MusicalityClip[]>(
		selectedVideoId
			? [...allMusicality.filter(m => m.videoId === selectedVideoId)].sort((a, b) => a.startTime - b.startTime)
			: []
	);
	const songLen = $derived(selectedVideo?.duration ?? 0);
	const currentClip = $derived<MusicalityClip | null>(clips[currentClipIdx] ?? null);

	const segmentStart = $derived(currentClip ? Math.max(0, currentClip.startTime - currentClip.bufferBefore) : 0);
	const segmentEnd = $derived(currentClip ? Math.min(songLen || Infinity, currentClip.endTime + currentClip.bufferAfter) : 0);
	const totalSegDur = $derived(Math.max(0, segmentEnd - segmentStart));
	const activeStartOffset = $derived(currentClip ? currentClip.startTime - segmentStart : 0);
	const activeEndOffset = $derived(currentClip ? currentClip.endTime - segmentStart : 0);

	const playerActive = $derived(phase === 'lead-in' || phase === 'active' || phase === 'lead-out' || phase === 'paused');

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
			if (raw) {
				const c = JSON.parse(raw);
				if (typeof c.selectedVideoId === 'string') selectedVideoId = c.selectedVideoId;
				if (typeof c.defaultBufferBefore === 'number') defaultBufferBefore = c.defaultBufferBefore;
				if (typeof c.defaultBufferAfter === 'number') defaultBufferAfter = c.defaultBufferAfter;
				if (typeof c.defaultLoops === 'number') defaultLoops = c.defaultLoops;
				if (typeof c.playbackRate === 'number' && SPEEDS.includes(c.playbackRate as never)) playbackRate = c.playbackRate;
				if (typeof c.overrideExisting === 'boolean') overrideExisting = c.overrideExisting;
			}
		} catch {
			// ignore
		}
		offlineMode = store.isOfflineMode();
		prefetchAllWithClips();
		refreshCacheStats();
	});

	$effect(() => {
		const c = { selectedVideoId, defaultBufferBefore, defaultBufferAfter, defaultLoops, playbackRate, overrideExisting };
		try {
			localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
		} catch {
			// ignore
		}
	});

	// Load editor audio for the selected song
	$effect(() => {
		if (!selectedVideo) {
			editorAudioUrl = '';
			return;
		}
		(async () => {
			const url = await ensureAudio(selectedVideo.id);
			if (url) editorAudioUrl = url;
		})();
	});

	// When override is enabled, propagate current defaults into every existing
	// clip for the selected song. Re-fires on default changes, song changes,
	// and clip-list changes — but only writes if anything actually differs,
	// so it stabilizes after one round and won't infinite-loop.
	$effect(() => {
		if (!overrideExisting) return;
		const id = selectedVideoId;
		if (!id) return;
		const bb = defaultBufferBefore;
		const ba = defaultBufferAfter;
		const lc = defaultLoops;
		const songClips = clips;
		if (songClips.length === 0) return;
		const needsUpdate = songClips.some(c =>
			c.bufferBefore !== bb || c.bufferAfter !== ba || c.loopCount !== lc
		);
		if (!needsUpdate) return;
		const updated = songClips.map(c => ({ ...c, bufferBefore: bb, bufferAfter: ba, loopCount: lc }));
		store.setMusicalityForVideo(id, updated);
	});

	function applyDefaultsToAllClips() {
		if (!selectedVideoId || clips.length === 0) return;
		const updated = clips.map(c => ({
			...c,
			bufferBefore: defaultBufferBefore,
			bufferAfter: defaultBufferAfter,
			loopCount: defaultLoops,
		}));
		store.setMusicalityForVideo(selectedVideoId, updated);
	}

	// Persistent disk cache via Cache API — survives page reloads.
	// In-memory `audioCache` still holds blob: URLs (one per page load),
	// but the underlying bytes come from disk on second mount, so we don't
	// re-download from the CDN.
	const PERSISTENT_CACHE_NAME = 'musicality-audio-v1';

	async function loadBlobFromCacheOrFetch(url: string): Promise<Blob> {
		if (typeof caches !== 'undefined') {
			try {
				const cache = await caches.open(PERSISTENT_CACHE_NAME);
				const hit = await cache.match(url);
				if (hit) return await hit.blob();
				const res = await fetch(url);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				// Clone before reading body — cache.put consumes it
				cache.put(url, res.clone()).catch(e => console.warn('cache.put failed', e));
				return await res.blob();
			} catch (e) {
				console.warn('Cache API path failed, falling back to plain fetch:', e);
			}
		}
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.blob();
	}

	async function ensureAudio(videoId: string): Promise<string | null> {
		const cached = audioCache.get(videoId);
		if (cached) return cached;
		const url = store.getCdnUrlForVideo(videoId);
		if (!url) return null;
		try {
			// In offline mode, only read from disk cache — never hit the network
			if (offlineMode && typeof caches !== 'undefined') {
				const cache = await caches.open(PERSISTENT_CACHE_NAME);
				const hit = await cache.match(url);
				if (!hit) return null;
				const blob = await hit.blob();
				const blobUrl = URL.createObjectURL(blob);
				audioCache.set(videoId, blobUrl);
				return blobUrl;
			}
			const blob = await loadBlobFromCacheOrFetch(url);
			const blobUrl = URL.createObjectURL(blob);
			audioCache.set(videoId, blobUrl);
			return blobUrl;
		} catch (e) {
			console.error('Audio prefetch failed', videoId, e);
			return null;
		}
	}

	// --- Offline mode + cache stats ---

	const idsWithMusicality = $derived([...new Set(allMusicality.map(m => m.videoId))]);

	async function refreshCacheStats() {
		if (typeof caches === 'undefined') return;
		try {
			const cache = await caches.open(PERSISTENT_CACHE_NAME);
			let count = 0;
			for (const id of idsWithMusicality) {
				const url = store.getCdnUrlForVideo(id);
				if (url && (await cache.match(url))) count++;
			}
			cachedSongs = count;
			if ('storage' in navigator && 'estimate' in navigator.storage) {
				const est = await navigator.storage.estimate();
				if (est.usage) storageEstimateMb = Math.round(est.usage / 1024 / 1024);
			}
		} catch (e) {
			console.warn('refreshCacheStats failed:', e);
		}
	}

	async function downloadAllForOffline() {
		if (downloadingAll) return;
		downloadingAll = true;
		downloadAllProgress = 0;
		downloadAllTotal = idsWithMusicality.length;
		try {
			for (const id of idsWithMusicality) {
				await ensureAudio(id);
				downloadAllProgress++;
				if (downloadAllProgress % 5 === 0) refreshCacheStats();
			}
			// Snapshot the latest metadata so init can read it offline
			const meta = {
				videos: store.getVideos().map(v => ({ ...v })),
				clips: store.getClips().map(c => ({ ...c })),
				practices: store.getPractices().map(p => ({ ...p })),
				musicality: store.getMusicality().map(m => ({ ...m })),
			};
			await import('$lib/bunny').then(m => m.cacheMetadataLocally(meta));
		} finally {
			downloadingAll = false;
			refreshCacheStats();
		}
	}

	async function clearOfflineCache() {
		if (!confirm('Delete all cached audio? Songs will need to re-download next time.')) return;
		if (typeof caches !== 'undefined') {
			await caches.delete(PERSISTENT_CACHE_NAME);
			await caches.delete('clipit-metadata-v1');
		}
		// Revoke any in-memory blob URLs
		for (const url of audioCache.values()) URL.revokeObjectURL(url);
		audioCache.clear();
		refreshCacheStats();
	}

	function toggleOfflineMode() {
		offlineMode = !offlineMode;
		store.setOfflineMode(offlineMode);
	}

	async function prefetchAllWithClips() {
		const idsWithClips = new Set(allMusicality.map(m => m.videoId));
		const targets = videos.filter(v => idsWithClips.has(v.id));
		if (targets.length === 0) return;
		prefetchInProgress = true;
		prefetchTotal = targets.length;
		prefetchDone = 0;
		// Sequential to avoid hammering CDN
		for (const v of targets) {
			await ensureAudio(v.id);
			prefetchDone++;
		}
		prefetchInProgress = false;
	}

	async function downloadCurrentSong() {
		if (!selectedVideo) return;
		await ensureAudio(selectedVideo.id);
	}

	onDestroy(() => {
		if (editorAudioEl) editorAudioEl.pause();
		if (playerAudioEl) playerAudioEl.pause();
		for (const url of audioCache.values()) URL.revokeObjectURL(url);
		audioCache.clear();
	});

	// --- Editor controls ---

	function toggleEditorPlay() {
		if (!editorAudioEl) return;
		if (editorPlaying) {
			editorAudioEl.pause();
		} else {
			editorAudioEl.play().catch(() => {});
		}
	}

	function handleEditorTimeUpdate() {
		if (!editorAudioEl) return;
		editorTime = editorAudioEl.currentTime;
	}

	function handleEditorLoaded() {
		if (!editorAudioEl) return;
		editorDuration = editorAudioEl.duration || (selectedVideo?.duration ?? 0);
	}

	function seekEditor(e: MouseEvent) {
		if (!editorAudioEl || editorDuration <= 0) return;
		const bar = e.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		editorAudioEl.currentTime = pct * editorDuration;
		editorTime = editorAudioEl.currentTime;
	}

	function nudgeEditor(deltaSec: number) {
		if (!editorAudioEl || editorDuration <= 0) return;
		const t = Math.max(0, Math.min(editorDuration, editorAudioEl.currentTime + deltaSec));
		editorAudioEl.currentTime = t;
		editorTime = t;
	}

	function markIn() {
		if (!editorAudioEl) return;
		draftStart = editorAudioEl.currentTime;
		if (draftEnd !== null && draftEnd <= draftStart) draftEnd = null;
	}

	function markOut() {
		if (!editorAudioEl) return;
		const t = editorAudioEl.currentTime;
		if (draftStart !== null && t > draftStart) draftEnd = t;
		else if (draftStart === null) {
			// Treat as start
			draftStart = t;
		}
	}

	function clearDraft() {
		draftStart = null;
		draftEnd = null;
		draftName = '';
	}

	function addClipFromDraft() {
		if (!selectedVideo || draftStart === null || draftEnd === null) return;
		if (draftEnd <= draftStart) return;
		store.addMusicalityClip({
			videoId: selectedVideo.id,
			name: draftName.trim() || undefined,
			startTime: draftStart,
			endTime: draftEnd,
			bufferBefore: defaultBufferBefore,
			bufferAfter: defaultBufferAfter,
			loopCount: defaultLoops,
		});
		clearDraft();
	}

	function updateClip(id: string, patch: Partial<Omit<MusicalityClip, 'id' | 'videoId'>>) {
		store.updateMusicalityClip(id, patch);
	}

	function deleteClip(id: string) {
		store.deleteMusicalityClip(id);
		if (currentClipIdx >= clips.length - 1) currentClipIdx = Math.max(0, clips.length - 2);
	}

	// --- Practice player ---

	async function startPlayback() {
		if (!selectedVideo || clips.length === 0 || !playerAudioEl) return;
		const url = await ensureAudio(selectedVideo.id);
		if (!url) return;
		// Pause editor so two audios don't overlap
		if (editorAudioEl) editorAudioEl.pause();
		currentClipIdx = 0;
		currentLoop = 1;
		segElapsed = 0;
		seekToCurrentSegmentStart(url);
	}

	async function playClip(idx: number) {
		if (!selectedVideo || idx < 0 || idx >= clips.length || !playerAudioEl) return;
		const url = await ensureAudio(selectedVideo.id);
		if (!url) return;
		if (editorAudioEl) editorAudioEl.pause();
		currentClipIdx = idx;
		currentLoop = 1;
		segElapsed = 0;
		seekToCurrentSegmentStart(url);
	}

	function seekToCurrentSegmentStart(url: string) {
		if (!playerAudioEl || !currentClip) return;
		pendingSeekTo = segmentStart;
		phase = 'lead-in';
		// If src didn't change, seek directly. Otherwise wait for loadedmetadata.
		if (playerAudioEl.src === url && playerAudioEl.readyState >= 1) {
			needsSeek = false;
			playerAudioEl.currentTime = pendingSeekTo;
			playerAudioEl.playbackRate = playbackRate;
			playerAudioEl.play().catch(() => {});
		} else {
			needsSeek = true;
			playerAudioUrl = url;
		}
	}

	function handlePlayerLoaded() {
		if (!playerAudioEl || !needsSeek) return;
		needsSeek = false;
		playerAudioEl.currentTime = pendingSeekTo;
		playerAudioEl.playbackRate = playbackRate;
		playerAudioEl.play().catch(() => {});
	}

	function handlePlayerTimeUpdate() {
		if (!playerAudioEl || !currentClip || phase === 'idle' || phase === 'ended' || phase === 'paused') return;
		if (needsSeek) return;
		const t = playerAudioEl.currentTime;
		segElapsed = Math.max(0, t - segmentStart);
		// Phase tracking
		if (t < currentClip.startTime) phase = 'lead-in';
		else if (t < currentClip.endTime) phase = 'active';
		else if (t < segmentEnd) phase = 'lead-out';
		// End of segment
		if (t >= segmentEnd) {
			advanceSegment();
		}
	}

	let lastAdvanceAt = 0;
	function advanceSegment() {
		if (!currentClip || !playerAudioEl) return;
		// Re-entry guard: if currentTime is already back near segmentStart, this is a stale
		// timeupdate from before the previous seek took effect — ignore it.
		if (playerAudioEl.currentTime < segmentEnd - 0.5) return;
		// Time-based guard: don't allow two advances within 200ms (covers rapid stale events).
		const now = performance.now();
		if (now - lastAdvanceAt < 200) return;
		lastAdvanceAt = now;
		if (currentLoop < currentClip.loopCount) {
			currentLoop += 1;
			segElapsed = 0;
			playerAudioEl.currentTime = segmentStart;
			phase = 'lead-in';
			playerAudioEl.play().catch(() => {});
			return;
		}
		if (currentClipIdx >= clips.length - 1) {
			endPlayback();
			return;
		}
		currentClipIdx += 1;
		currentLoop = 1;
		segElapsed = 0;
		playerAudioEl.currentTime = segmentStart;
		phase = 'lead-in';
		playerAudioEl.play().catch(() => {});
	}

	function previousSegment() {
		if (!playerAudioEl || clips.length === 0) return;
		if (currentLoop > 1) {
			currentLoop -= 1;
		} else if (currentClipIdx > 0) {
			currentClipIdx -= 1;
			currentLoop = 1;
		} else {
			// Restart current
		}
		segElapsed = 0;
		if (currentClip) playerAudioEl.currentTime = segmentStart;
		phase = 'lead-in';
		playerAudioEl.play().catch(() => {});
	}

	function nextSegment() {
		if (!playerAudioEl || clips.length === 0) return;
		if (currentClipIdx >= clips.length - 1) {
			endPlayback();
			return;
		}
		currentClipIdx += 1;
		currentLoop = 1;
		segElapsed = 0;
		playerAudioEl.currentTime = segmentStart;
		phase = 'lead-in';
		playerAudioEl.play().catch(() => {});
	}

	function togglePause() {
		if (!playerAudioEl) return;
		if (phase === 'paused') {
			phase = resumePhase;
			playerAudioEl.play().catch(() => {});
		} else if (phase === 'lead-in' || phase === 'active' || phase === 'lead-out') {
			resumePhase = phase;
			playerAudioEl.pause();
			phase = 'paused';
		}
	}

	function endPlayback() {
		if (playerAudioEl) playerAudioEl.pause();
		phase = 'ended';
	}

	function resetToIdle() {
		if (playerAudioEl) playerAudioEl.pause();
		phase = 'idle';
		currentClipIdx = 0;
		currentLoop = 1;
		segElapsed = 0;
	}

	function setSpeed(s: number) {
		playbackRate = s;
		if (playerAudioEl) playerAudioEl.playbackRate = s;
	}

	function seekSegment(e: MouseEvent) {
		if (!playerAudioEl || !currentClip) return;
		const bar = e.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		const newElapsed = pct * totalSegDur;
		playerAudioEl.currentTime = segmentStart + newElapsed;
		segElapsed = newElapsed;
	}

	function pickVideo(id: string) {
		selectedVideoId = id;
		showPicker = false;
		pickerSearch = '';
		clearDraft();
		resetToIdle();
		editorTime = 0;
		editorPlaying = false;
	}

	function formatTime(s: number): string {
		if (!isFinite(s) || s < 0) s = 0;
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	const editorPctOf = (t: number) => editorDuration > 0 ? (t / editorDuration) * 100 : 0;
	const audioReady = $derived(selectedVideo ? audioCache.has(selectedVideo.id) : false);
</script>

<audio
	bind:this={playerAudioEl}
	src={playerAudioUrl}
	preload="auto"
	onloadedmetadata={handlePlayerLoaded}
	ontimeupdate={handlePlayerTimeUpdate}
></audio>

<audio
	bind:this={editorAudioEl}
	src={editorAudioUrl}
	preload="auto"
	onplay={() => editorPlaying = true}
	onpause={() => editorPlaying = false}
	onloadedmetadata={handleEditorLoaded}
	ontimeupdate={handleEditorTimeUpdate}
></audio>

<div class="page">
	<header class="hero">
		<h1>Musicality {#if offlineMode}<span class="offline-pill">offline</span>{/if}</h1>
		<p class="sub">Mark interesting moments in a song. Each clip plays with a lead-in &amp; lead-out so you can settle into the musicality.</p>
		{#if prefetchInProgress}
			<div class="prefetch-bar">
				<div class="prefetch-fill" style="width: {prefetchTotal > 0 ? (prefetchDone / prefetchTotal) * 100 : 0}%"></div>
				<span class="prefetch-text">Caching audio · {prefetchDone}/{prefetchTotal}</span>
			</div>
		{/if}
	</header>

	<!-- Offline / cache controls -->
	<section class="panel offline-panel">
		<div class="offline-row">
			<div class="offline-summary">
				<div class="offline-title">
					{cachedSongs}/{idsWithMusicality.length} songs cached for offline
					{#if storageEstimateMb !== null}
						<span class="offline-storage">· {storageEstimateMb} MB used</span>
					{/if}
				</div>
				<div class="offline-hint">
					{#if offlineMode && cachedSongs < idsWithMusicality.length}
						<span class="offline-warn">Offline mode is on but {idsWithMusicality.length - cachedSongs} song{idsWithMusicality.length - cachedSongs === 1 ? '' : 's'} aren't cached — they won't play. Toggle off + download first.</span>
					{:else if offlineMode}
						You're in offline mode — no network requests. Edits save locally and will push to Bunny next time you go online.
					{:else if cachedSongs < idsWithMusicality.length}
						Download every song to make this page work fully offline.
					{:else}
						Every song is cached. You can switch to offline mode any time.
					{/if}
				</div>
			</div>
			<div class="offline-actions">
				{#if downloadingAll}
					<div class="download-progress">
						Downloading {downloadAllProgress}/{downloadAllTotal}…
					</div>
				{:else if cachedSongs < idsWithMusicality.length}
					<button class="ghost-btn small" onclick={downloadAllForOffline}>
						Download {idsWithMusicality.length - cachedSongs} song{idsWithMusicality.length - cachedSongs === 1 ? '' : 's'}
					</button>
				{:else}
					<button class="ghost-btn small" onclick={clearOfflineCache} title="Free up disk space">Clear cache</button>
				{/if}
				<label class="checkbox-row offline-toggle">
					<input type="checkbox" checked={offlineMode} onchange={toggleOfflineMode} />
					<span>Offline mode</span>
				</label>
			</div>
		</div>
		{#if downloadingAll && downloadAllTotal > 0}
			<div class="prefetch-bar offline-progress">
				<div class="prefetch-fill" style="width: {(downloadAllProgress / downloadAllTotal) * 100}%"></div>
			</div>
		{/if}
	</section>

	<!-- Practice player -->
	<section class="player-card" class:active={playerActive}>
		{#if !selectedVideo}
			<div class="idle">
				<p class="hint">Pick a song below to get started.</p>
			</div>
		{:else if clips.length === 0}
			<div class="idle">
				<div class="song-name">{selectedVideo.name}</div>
				<p class="hint">No clips yet. Use the editor below to mark moments in the song.</p>
			</div>
		{:else if phase === 'idle'}
			<div class="idle">
				<div class="song-name">{selectedVideo.name}</div>
				<div class="meta-row">
					<span>{clips.length} clip{clips.length === 1 ? '' : 's'}</span>
					<span class="dot"></span>
					<span>{formatTime(songLen)}</span>
					{#if !audioReady}
						<span class="dot"></span>
						<span class="warn-text">audio streaming</span>
					{/if}
				</div>
				<button class="start-btn" onclick={startPlayback}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
						<polygon points="5 3 19 12 5 21 5 3" />
					</svg>
					Practice
				</button>
				{#if !audioReady}
					<button class="ghost-btn small" onclick={downloadCurrentSong}>Download for instant playback</button>
				{/if}
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
		{:else if currentClip}
			<div class="now-playing">
				<div class="now-header">
					<div class="now-title">
						<div class="section-name">{currentClip.name ?? `Clip ${currentClipIdx + 1}`}</div>
						<div class="now-meta">
							<span>{currentClipIdx + 1} / {clips.length}</span>
							{#if currentClip.loopCount > 1}
								<span class="dot"></span>
								<span>loop {currentLoop}/{currentClip.loopCount}</span>
							{/if}
							<span class="dot"></span>
							<span>{formatTime(currentClip.startTime)} – {formatTime(currentClip.endTime)}</span>
						</div>
					</div>
					<button class="icon-btn" onclick={endPlayback} title="Stop">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
							<rect x="5" y="5" width="14" height="14" rx="1" />
						</svg>
					</button>
				</div>

				<div class="phase-strip" class:p-leadin={phase === 'lead-in'} class:p-active={phase === 'active'} class:p-leadout={phase === 'lead-out'} class:p-paused={phase === 'paused'}>
					{#if phase === 'lead-in'}
						<span>Get ready · {Math.max(0, Math.ceil(currentClip.startTime - (segmentStart + segElapsed)))}s</span>
					{:else if phase === 'active'}
						<span>NOW · {Math.max(0, Math.ceil(currentClip.endTime - (segmentStart + segElapsed)))}s</span>
					{:else if phase === 'lead-out'}
						<span>Wind down · {Math.max(0, Math.ceil(segmentEnd - (segmentStart + segElapsed)))}s</span>
					{:else if phase === 'paused'}
						<span>Paused</span>
					{/if}
				</div>

				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="progress-bar seekable" onclick={seekSegment}>
					<!-- background bands for buffer/active -->
					{#if totalSegDur > 0}
						<div class="band band-active" style="left: {(activeStartOffset / totalSegDur) * 100}%; width: {((activeEndOffset - activeStartOffset) / totalSegDur) * 100}%"></div>
					{/if}
					<div class="progress-fill" style="width: {totalSegDur > 0 ? Math.min(100, (segElapsed / totalSegDur) * 100) : 0}%"></div>
				</div>

				<div class="controls">
					<button class="ctrl-btn" onclick={previousSegment} disabled={currentClipIdx === 0 && currentLoop === 1} title="Previous">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="19 20 9 12 19 4" /><line x1="5" y1="4" x2="5" y2="20" /></svg>
						Prev
					</button>
					<button class="ctrl-btn primary" onclick={togglePause}>
						{#if phase === 'paused'}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
							Resume
						{:else}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
							Pause
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
						{#if audioReady}<span class="badge sm cached-badge">cached</span>{/if}
					</div>
				</div>
			</div>
		{/if}
		{#if showPicker}
			<input type="text" class="search" placeholder="Search videos..." bind:value={pickerSearch} />
			<div class="picker-list">
				{#each filteredVideos as v (v.id)}
					{@const vClipCount = allMusicality.filter(m => m.videoId === v.id).length}
					<button class="picker-row" class:active={v.id === selectedVideoId} onclick={() => pickVideo(v.id)}>
						<div class="picker-info">
							<div class="picker-name">{v.name}</div>
							<div class="picker-meta">
								{#if v.lead}{v.lead}{#if v.follow} &amp; {v.follow}{/if}{/if}
								{#if v.dance}<span class="badge sm">{v.dance}</span>{/if}
								<span>{formatTime(v.duration)}</span>
								{#if vClipCount > 0}
									<span class="badge sm clips-badge">{vClipCount} clip{vClipCount === 1 ? '' : 's'}</span>
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
		<!-- Defaults -->
		<section class="panel">
			<div class="panel-header">
				<h2>Defaults for new clips</h2>
			</div>
			<div class="cfg-grid">
				<div class="cfg-field">
					<label for="default-buffer-before" class="field-label-as-label">Buffer before (lead-in seconds)</label>
					<div class="number-row">
						<button class="num-btn" onclick={() => defaultBufferBefore = Math.max(0, defaultBufferBefore - 1)} disabled={defaultBufferBefore <= 0} aria-label="Decrease">−</button>
						<input id="default-buffer-before" type="number" class="num-input" min="0" max="60" step="1" value={defaultBufferBefore}
							oninput={(e) => { const v = parseInt((e.target as HTMLInputElement).value, 10); if (!isNaN(v)) defaultBufferBefore = Math.max(0, Math.min(60, v)); }} />
						<button class="num-btn" onclick={() => defaultBufferBefore = Math.min(60, defaultBufferBefore + 1)} disabled={defaultBufferBefore >= 60} aria-label="Increase">+</button>
						<span class="num-suffix">seconds before the moment</span>
					</div>
				</div>
				<div class="cfg-field">
					<label for="default-buffer-after" class="field-label-as-label">Buffer after (lead-out seconds)</label>
					<div class="number-row">
						<button class="num-btn" onclick={() => defaultBufferAfter = Math.max(0, defaultBufferAfter - 1)} disabled={defaultBufferAfter <= 0} aria-label="Decrease">−</button>
						<input id="default-buffer-after" type="number" class="num-input" min="0" max="60" step="1" value={defaultBufferAfter}
							oninput={(e) => { const v = parseInt((e.target as HTMLInputElement).value, 10); if (!isNaN(v)) defaultBufferAfter = Math.max(0, Math.min(60, v)); }} />
						<button class="num-btn" onclick={() => defaultBufferAfter = Math.min(60, defaultBufferAfter + 1)} disabled={defaultBufferAfter >= 60} aria-label="Increase">+</button>
						<span class="num-suffix">seconds after the moment</span>
					</div>
				</div>
				<div class="cfg-field">
					<label for="default-loops" class="field-label-as-label">Default loops per clip</label>
					<div class="number-row">
						<button class="num-btn" onclick={() => defaultLoops = Math.max(1, defaultLoops - 1)} disabled={defaultLoops <= 1} aria-label="Decrease">−</button>
						<input id="default-loops" type="number" class="num-input" min="1" max="20" step="1" value={defaultLoops}
							oninput={(e) => { const v = parseInt((e.target as HTMLInputElement).value, 10); if (!isNaN(v)) defaultLoops = Math.max(1, Math.min(20, v)); }} />
						<button class="num-btn" onclick={() => defaultLoops = Math.min(20, defaultLoops + 1)} disabled={defaultLoops >= 20} aria-label="Increase">+</button>
					</div>
				</div>

				<div class="override-row">
					<label class="checkbox-row">
						<input type="checkbox" bind:checked={overrideExisting} />
						<span>Override existing clips on this song with these defaults</span>
					</label>
					{#if !overrideExisting && clips.length > 0}
						<button class="ghost-btn small" onclick={applyDefaultsToAllClips}>
							Apply once to {clips.length} clip{clips.length === 1 ? '' : 's'}
						</button>
					{/if}
					{#if overrideExisting}
						<p class="override-hint">Per-clip in/out/loop edits below are now disabled — they'd be overwritten on every change. Uncheck to edit individually.</p>
					{/if}
				</div>
			</div>
		</section>

		<!-- Editor: scrub the song, mark in/out -->
		<section class="panel">
			<div class="panel-header">
				<h2>Mark a moment</h2>
				<span class="header-count">{formatTime(editorTime)} / {formatTime(editorDuration || songLen)}</span>
			</div>

			<div class="editor-controls">
				<button class="ctrl-btn primary" onclick={toggleEditorPlay}>
					{#if editorPlaying}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
						Pause
					{:else}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
						Play
					{/if}
				</button>
				<button class="ctrl-btn" onclick={() => nudgeEditor(-5)} title="Back 5s">−5s</button>
				<button class="ctrl-btn" onclick={() => nudgeEditor(-1)} title="Back 1s">−1s</button>
				<button class="ctrl-btn" onclick={() => nudgeEditor(1)} title="Forward 1s">+1s</button>
				<button class="ctrl-btn" onclick={() => nudgeEditor(5)} title="Forward 5s">+5s</button>
			</div>

			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="editor-track" onclick={seekEditor}>
				<!-- existing clip markers -->
				{#each clips as c, i (c.id)}
					<div
						class="editor-clip-marker"
						class:active={playerActive && i === currentClipIdx}
						style="left: {editorPctOf(c.startTime)}%; width: {editorPctOf(c.endTime - c.startTime)}%; background-color: hsl({(i * 360) / clips.length}, 50%, 35%);"
						title="{c.name ?? 'Clip'} ({formatTime(c.startTime)} – {formatTime(c.endTime)})"
					></div>
				{/each}
				<!-- draft marker -->
				{#if draftStart !== null}
					<div class="editor-draft-line" style="left: {editorPctOf(draftStart)}%"></div>
				{/if}
				{#if draftStart !== null && draftEnd !== null}
					<div class="editor-draft-band" style="left: {editorPctOf(draftStart)}%; width: {editorPctOf(draftEnd - draftStart)}%"></div>
				{/if}
				{#if draftEnd !== null}
					<div class="editor-draft-line end" style="left: {editorPctOf(draftEnd)}%"></div>
				{/if}
				<!-- playhead -->
				<div class="editor-playhead" style="left: {editorPctOf(editorTime)}%"></div>
			</div>

			<div class="mark-row">
				<button class="mark-btn in" onclick={markIn}>Mark IN ({formatTime(editorTime)})</button>
				<button class="mark-btn out" onclick={markOut} disabled={draftStart === null || editorTime <= (draftStart ?? 0)}>Mark OUT ({formatTime(editorTime)})</button>
			</div>

			{#if draftStart !== null}
				<div class="draft-card">
					<div class="draft-times">
						<span class="draft-label">In</span>
						<span class="draft-val">{formatTime(draftStart)}</span>
						<span class="draft-arrow">→</span>
						<span class="draft-label">Out</span>
						<span class="draft-val">{draftEnd !== null ? formatTime(draftEnd) : '—'}</span>
						{#if draftEnd !== null}
							<span class="draft-dur">({(draftEnd - draftStart).toFixed(1)}s)</span>
						{/if}
					</div>
					<input
						type="text"
						class="draft-name"
						placeholder="Name (optional)"
						bind:value={draftName}
					/>
					<div class="draft-actions">
						<button class="primary-btn" onclick={addClipFromDraft} disabled={draftEnd === null || draftEnd <= draftStart}>
							Add clip
						</button>
						<button class="ghost-btn small" onclick={clearDraft}>Cancel</button>
					</div>
				</div>
			{/if}
		</section>

		<!-- Clip list -->
		{#if clips.length > 0}
			<section class="panel">
				<div class="panel-header">
					<h2>Clips</h2>
					<span class="header-count">{clips.length} clip{clips.length === 1 ? '' : 's'}</span>
				</div>
				<div class="section-list">
					{#each clips as c, i (c.id)}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="clip-row clickable"
							class:active={i === currentClipIdx && playerActive}
							onclick={(e) => {
								// Ignore clicks on inputs/buttons inside the row
								if ((e.target as HTMLElement).closest('button, input')) return;
								playClip(i);
							}}
							title="Click to play this clip"
						>
							<span class="seg-index">{i + 1}</span>
							<input
								type="text"
								class="seg-name-input"
								value={c.name ?? ''}
								oninput={(e) => updateClip(c.id, { name: (e.target as HTMLInputElement).value || undefined })}
								placeholder={`Clip ${i + 1}`}
							/>
							<div class="time-cell">
								<span class="seg-time">{formatTime(c.startTime)} – {formatTime(c.endTime)}</span>
								<span class="seg-dur">{(c.endTime - c.startTime).toFixed(1)}s</span>
							</div>
							<div class="buffer-cell" title={overrideExisting ? 'Locked — uncheck "Override existing clips" to edit per-clip' : 'Lead-in seconds'}>
								<span class="cell-label">in</span>
								<button class="num-btn tiny" onclick={() => updateClip(c.id, { bufferBefore: Math.max(0, c.bufferBefore - 1) })} disabled={overrideExisting || c.bufferBefore <= 0} aria-label="Decrease">−</button>
								<span class="loop-val">{c.bufferBefore}s</span>
								<button class="num-btn tiny" onclick={() => updateClip(c.id, { bufferBefore: Math.min(60, c.bufferBefore + 1) })} disabled={overrideExisting || c.bufferBefore >= 60} aria-label="Increase">+</button>
							</div>
							<div class="buffer-cell" title={overrideExisting ? 'Locked — uncheck "Override existing clips" to edit per-clip' : 'Lead-out seconds'}>
								<span class="cell-label">out</span>
								<button class="num-btn tiny" onclick={() => updateClip(c.id, { bufferAfter: Math.max(0, c.bufferAfter - 1) })} disabled={overrideExisting || c.bufferAfter <= 0} aria-label="Decrease">−</button>
								<span class="loop-val">{c.bufferAfter}s</span>
								<button class="num-btn tiny" onclick={() => updateClip(c.id, { bufferAfter: Math.min(60, c.bufferAfter + 1) })} disabled={overrideExisting || c.bufferAfter >= 60} aria-label="Increase">+</button>
							</div>
							<div class="buffer-cell" title={overrideExisting ? 'Locked — uncheck "Override existing clips" to edit per-clip' : 'Loops'}>
								<span class="cell-label">×</span>
								<button class="num-btn tiny" onclick={() => updateClip(c.id, { loopCount: Math.max(1, c.loopCount - 1) })} disabled={overrideExisting || c.loopCount <= 1} aria-label="Decrease">−</button>
								<span class="loop-val">{c.loopCount}</span>
								<button class="num-btn tiny" onclick={() => updateClip(c.id, { loopCount: Math.min(20, c.loopCount + 1) })} disabled={overrideExisting || c.loopCount >= 20} aria-label="Increase">+</button>
							</div>
							<button class="row-btn danger" onclick={() => deleteClip(c.id)} disabled title="Deletion disabled in UI — edit metadata.json manually">
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
		max-width: 760px;
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

	.prefetch-bar {
		position: relative;
		margin-top: 10px;
		height: 22px;
		border-radius: 5px;
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.06);
		overflow: hidden;
	}
	.prefetch-fill {
		position: absolute; top: 0; left: 0; bottom: 0;
		background: rgba(99, 102, 241, 0.25);
		transition: width 0.2s linear;
	}
	.prefetch-text {
		position: relative; display: flex; align-items: center; justify-content: center;
		height: 100%; font-size: 11px; color: #a5b4fc; font-weight: 500;
	}

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
		display: flex; flex-direction: column; align-items: center; gap: 12px;
		padding: 16px 0; text-align: center;
	}
	.song-name { font-size: 18px; font-weight: 700; color: #e4e4e7; }
	.meta-row {
		display: flex; align-items: center; gap: 8px;
		color: #71717a; font-size: 13px; font-variant-numeric: tabular-nums;
	}
	.dot { width: 3px; height: 3px; border-radius: 50%; background: #3f3f46; }
	.warn-text { color: #fbbf24; }

	.start-btn {
		display: flex; align-items: center; gap: 8px;
		background: #6366f1; color: #fff; border: none;
		padding: 12px 24px; border-radius: 10px;
		font-size: 14px; font-weight: 600; cursor: pointer;
		font-family: inherit; transition: background 0.15s;
	}
	.start-btn:hover:not(:disabled) { background: #7c3aed; }
	.start-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.hint { margin: 4px 0 0; color: #52525b; font-size: 12px; }

	.ended { text-align: center; padding: 20px 0; }
	.ended h2 { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
	.ended-actions { display: flex; gap: 10px; justify-content: center; }

	.now-header {
		display: flex; justify-content: space-between; align-items: flex-start;
		gap: 12px; margin-bottom: 12px;
	}
	.section-name {
		font-size: 18px; font-weight: 700; color: #e4e4e7;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.now-meta {
		margin-top: 4px; color: #71717a; font-size: 12px;
		display: flex; align-items: center; gap: 6px;
	}

	.phase-strip {
		display: flex; justify-content: center;
		padding: 18px 12px; margin-bottom: 12px;
		border-radius: 10px;
		font-size: 22px; font-weight: 700; letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
		transition: background 0.2s, color 0.2s;
	}
	.p-leadin { background: rgba(251, 191, 36, 0.12); color: #fcd34d; }
	.p-active { background: rgba(34, 197, 94, 0.18); color: #4ade80; box-shadow: 0 0 24px rgba(34, 197, 94, 0.18) inset; }
	.p-leadout { background: rgba(99, 102, 241, 0.12); color: #a5b4fc; }
	.p-paused { background: rgba(255, 255, 255, 0.06); color: #a1a1aa; }

	.progress-bar {
		position: relative;
		height: 8px; background: rgba(255, 255, 255, 0.06);
		border-radius: 4px; overflow: hidden; margin-bottom: 16px;
	}
	.progress-bar.seekable { cursor: pointer; }
	.progress-bar.seekable:hover { height: 10px; }
	.band {
		position: absolute; top: 0; bottom: 0;
	}
	.band-active { background: rgba(34, 197, 94, 0.18); }
	.progress-fill {
		position: relative;
		height: 100%; background: #6366f1;
		transition: width 0.1s linear;
	}

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
	.ctrl-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
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
		padding: 8px 10px; border-radius: 8px;
		font-size: 12px; font-weight: 600;
		font-family: inherit; cursor: pointer;
		-webkit-appearance: none; appearance: none;
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
	.header-count { color: #52525b; font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }

	.ghost-btn {
		background: none; border: 1px solid rgba(255, 255, 255, 0.08);
		color: #a1a1aa; padding: 8px 14px; border-radius: 6px;
		font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit;
	}
	.ghost-btn:hover { color: #e4e4e7; background: rgba(255, 255, 255, 0.04); }
	.ghost-btn.small { padding: 4px 10px; font-size: 12px; }

	.primary-btn {
		background: #6366f1; color: #fff; border: none;
		padding: 9px 18px; border-radius: 8px;
		font-size: 13px; font-weight: 600;
		cursor: pointer; font-family: inherit;
	}
	.primary-btn:hover:not(:disabled) { background: #7c3aed; }
	.primary-btn:disabled { opacity: 0.4; cursor: not-allowed; }

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
	.badge.clips-badge { background: rgba(99, 102, 241, 0.15); color: #a5b4fc; }
	.badge.cached-badge { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
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
	.num-input::-webkit-outer-spin-button,
	.num-input::-webkit-inner-spin-button {
		-webkit-appearance: none; margin: 0;
	}
	.num-input:focus { outline: none; border-color: rgba(99, 102, 241, 0.4); }
	.num-suffix { color: #71717a; font-size: 12px; margin-left: 4px; }

	.offline-pill {
		display: inline-block; margin-left: 8px;
		font-size: 11px; font-weight: 600;
		padding: 2px 8px; border-radius: 999px;
		background: rgba(34, 197, 94, 0.15); color: #4ade80;
		text-transform: uppercase; letter-spacing: 0.04em;
		vertical-align: middle;
	}
	.offline-panel { padding: 14px 16px; }
	.offline-row {
		display: flex; align-items: center; justify-content: space-between;
		gap: 16px; flex-wrap: wrap;
	}
	.offline-summary { min-width: 0; flex: 1; }
	.offline-title {
		font-size: 13px; font-weight: 600; color: #e4e4e7;
		font-variant-numeric: tabular-nums;
	}
	.offline-storage { color: #71717a; font-weight: 500; margin-left: 4px; }
	.offline-hint { color: #71717a; font-size: 11px; margin-top: 4px; line-height: 1.5; }
	.offline-warn { color: #fbbf24; }
	.offline-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
	.offline-toggle { font-size: 12px; }
	.download-progress {
		font-size: 12px; color: #a5b4fc; font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.offline-progress { margin-top: 10px; height: 4px; }

	.override-row {
		margin-top: 6px;
		padding-top: 12px;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		display: flex; flex-direction: column; gap: 8px;
	}
	.checkbox-row {
		display: flex; align-items: center; gap: 8px;
		font-size: 13px; color: #e4e4e7; cursor: pointer;
	}
	.checkbox-row input[type="checkbox"] {
		width: 16px; height: 16px; accent-color: #6366f1; cursor: pointer;
	}
	.override-hint { margin: 0; color: #71717a; font-size: 11px; line-height: 1.5; }

	.editor-controls {
		display: flex; gap: 6px; align-items: center; margin-bottom: 12px;
		flex-wrap: wrap;
	}

	.editor-track {
		position: relative;
		height: 56px;
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
		margin-bottom: 12px;
		cursor: pointer;
		overflow: hidden;
	}
	.editor-clip-marker {
		position: absolute; top: 6px; bottom: 6px;
		opacity: 0.85;
		border-radius: 3px;
		transition: box-shadow 0.2s, transform 0.2s, opacity 0.2s, top 0.2s, bottom 0.2s;
	}
	.editor-clip-marker.active {
		opacity: 1;
		top: 2px; bottom: 2px;
		box-shadow: 0 0 0 2px #818cf8, 0 0 16px 4px rgba(129, 140, 248, 0.55);
		z-index: 1;
	}
	.editor-draft-band {
		position: absolute; top: 0; bottom: 0;
		background: rgba(34, 197, 94, 0.18);
		pointer-events: none;
	}
	.editor-draft-line {
		position: absolute; top: 0; bottom: 0;
		width: 2px; background: #4ade80;
		pointer-events: none;
	}
	.editor-draft-line.end { background: #f87171; }
	.editor-playhead {
		position: absolute; top: -2px; bottom: -2px;
		width: 2px; background: #fff; box-shadow: 0 0 8px rgba(255, 255, 255, 0.5);
		pointer-events: none;
		transform: translateX(-1px);
	}

	.mark-row {
		display: flex; gap: 8px; flex-wrap: wrap;
	}
	.mark-btn {
		flex: 1; min-width: 120px;
		padding: 12px 14px;
		border-radius: 8px;
		font-size: 13px; font-weight: 600;
		cursor: pointer; font-family: inherit;
		border: 1px solid;
		font-variant-numeric: tabular-nums;
	}
	.mark-btn.in {
		background: rgba(34, 197, 94, 0.12);
		border-color: rgba(34, 197, 94, 0.3);
		color: #4ade80;
	}
	.mark-btn.in:hover { background: rgba(34, 197, 94, 0.2); }
	.mark-btn.out {
		background: rgba(248, 113, 113, 0.1);
		border-color: rgba(248, 113, 113, 0.3);
		color: #f87171;
	}
	.mark-btn.out:hover:not(:disabled) { background: rgba(248, 113, 113, 0.2); }
	.mark-btn:disabled { opacity: 0.35; cursor: not-allowed; }

	.draft-card {
		margin-top: 12px;
		padding: 12px;
		background: rgba(99, 102, 241, 0.05);
		border: 1px dashed rgba(99, 102, 241, 0.3);
		border-radius: 8px;
		display: flex; flex-direction: column; gap: 10px;
	}
	.draft-times {
		display: flex; align-items: center; gap: 8px;
		font-variant-numeric: tabular-nums;
		font-size: 13px;
	}
	.draft-label { color: #71717a; font-size: 11px; text-transform: uppercase; font-weight: 600; }
	.draft-val { color: #e4e4e7; font-weight: 600; }
	.draft-arrow { color: #52525b; }
	.draft-dur { color: #a5b4fc; font-size: 12px; }
	.draft-name {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
		padding: 8px 10px; border-radius: 6px; font-size: 13px;
		font-family: inherit;
	}
	.draft-name:focus { outline: none; border-color: rgba(99, 102, 241, 0.4); }
	.draft-actions { display: flex; gap: 8px; }

	.section-list {
		display: flex; flex-direction: column; gap: 4px;
	}
	.clip-row {
		display: grid;
		grid-template-columns: 22px minmax(0, 1.2fr) auto auto auto auto auto;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 6px;
		transition: background 0.12s, border-color 0.12s;
	}
	.clip-row.clickable { cursor: pointer; }
	.clip-row.clickable:hover {
		background: rgba(255, 255, 255, 0.03);
		border-color: rgba(255, 255, 255, 0.08);
	}
	.clip-row.active {
		border-color: rgba(99, 102, 241, 0.5);
		background: rgba(99, 102, 241, 0.08);
		box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.3);
	}
	.seg-index {
		color: #52525b; font-size: 11px; font-weight: 600;
		text-align: center; font-variant-numeric: tabular-nums;
	}
	.clip-row.active .seg-index { color: #818cf8; }
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
	.time-cell { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
	.seg-time { font-size: 11px; color: #71717a; font-variant-numeric: tabular-nums; }
	.seg-dur { font-size: 10px; color: #52525b; font-variant-numeric: tabular-nums; }
	.buffer-cell {
		display: flex; align-items: center; gap: 3px;
	}
	.cell-label {
		color: #52525b; font-size: 10px; text-transform: uppercase;
		font-weight: 600; margin-right: 2px;
	}
	.loop-val {
		font-size: 11px; font-weight: 600; color: #e4e4e7;
		font-variant-numeric: tabular-nums; min-width: 24px; text-align: center;
	}
	.row-btn {
		background: none; border: none; color: #3f3f46;
		padding: 4px; border-radius: 4px; cursor: pointer;
	}
	.row-btn:hover:not(:disabled) { color: #a1a1aa; background: rgba(255, 255, 255, 0.04); }
	.row-btn.danger:hover:not(:disabled) { color: #ef4444; background: rgba(239, 68, 68, 0.08); }
	.row-btn:disabled { opacity: 0.3; cursor: not-allowed; }

	@media (max-width: 700px) {
		.clip-row {
			grid-template-columns: 22px 1fr auto auto;
			grid-template-areas:
				"idx name name del"
				"idx time bin bout"
				"idx loops loops loops";
			row-gap: 6px;
		}
		.seg-index { grid-area: idx; }
		.seg-name-input { grid-area: name; }
		.row-btn { grid-area: del; justify-self: end; }
		.time-cell { grid-area: time; align-items: flex-start; }
		.buffer-cell:nth-of-type(3) { grid-area: bin; }
		.buffer-cell:nth-of-type(4) { grid-area: bout; }
		.buffer-cell:nth-of-type(5) { grid-area: loops; justify-self: start; }
	}
</style>
