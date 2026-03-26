<script lang="ts">
	import type { ClipMeta } from '$lib/store.svelte';

	let {
		src,
		currentTime = $bindable(0),
		duration = $bindable(0),
		clipStart = 0,
		clipEnd = 0,
		clips = [],
		onSetIn,
		onSetOut
	}: {
		src: string;
		currentTime?: number;
		duration?: number;
		clipStart?: number;
		clipEnd?: number;
		clips?: ClipMeta[];
		onSetIn?: (time: number) => void;
		onSetOut?: (time: number) => void;
	} = $props();

	// If clipStart/clipEnd are set, constrain playback to that range
	// Optional 10s buffer before/after for finding the count in the song
	const CLIP_BUFFER = 10;
	let hasClipRange = $derived(clipEnd > clipStart);
	let showPreBuffer = $state(false);
	let showPostBuffer = $state(false);
	let rangeStart = $derived(hasClipRange ? (showPreBuffer ? Math.max(0, clipStart - CLIP_BUFFER) : clipStart) : 0);
	let rangeEnd = $derived(hasClipRange ? (showPostBuffer ? Math.min(duration, clipEnd + CLIP_BUFFER) : clipEnd) : duration);
	let rangeDuration = $derived(hasClipRange ? rangeEnd - rangeStart : duration);

	let videoEl: HTMLVideoElement | undefined = $state();
	let playerEl: HTMLElement | undefined = $state();
	let playing = $state(false);
	let looping = $state(true);
	let playbackRate = $state(1);
	let hoverTime = $state<number | null>(null);

	let fakeFullscreen = $state(false);

	function toggleFullscreen() {
		if (!playerEl) return;
		// Use native fullscreen if available, otherwise CSS fallback (iOS PWA)
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else if (typeof playerEl.requestFullscreen === 'function') {
			playerEl.requestFullscreen().catch(() => {
				// Fullscreen rejected (iOS PWA), use CSS fallback
				fakeFullscreen = !fakeFullscreen;
			});
		} else {
			fakeFullscreen = !fakeFullscreen;
		}
	}
	let timelineEl: HTMLElement | undefined = $state();

	function togglePlay() {
		if (!videoEl) return;
		if (videoEl.paused) {
			if (hasClipRange && (videoEl.currentTime < rangeStart || videoEl.currentTime >= rangeEnd)) {
				videoEl.currentTime = clipStart;
			}
			videoEl.play().catch(() => {});
		} else {
			videoEl.pause();
		}
	}

	function seek(delta: number) {
		if (!videoEl) return;
		const min = hasClipRange ? rangeStart : 0;
		const max = hasClipRange ? rangeEnd : duration;
		videoEl.currentTime = Math.max(min, Math.min(max, videoEl.currentTime + delta));
	}

	function setRate(rate: number) {
		playbackRate = rate;
		if (videoEl) videoEl.playbackRate = rate;
	}

	function handleTimeUpdate() {
		if (!videoEl) return;
		if (hasClipRange && videoEl.currentTime >= rangeEnd) {
			if (looping) {
				videoEl.currentTime = rangeStart;
			} else {
				videoEl.pause();
				videoEl.currentTime = rangeEnd;
			}
		}
		currentTime = videoEl.currentTime;
	}

	function handleLoadedMetadata() {
		if (!videoEl) return;
		// Use video element's duration if valid, keep existing (from metadata) as fallback
		if (videoEl.duration && isFinite(videoEl.duration) && videoEl.duration > 0) {
			duration = videoEl.duration;
		}
		if (hasClipRange) {
			videoEl.currentTime = clipStart;
		}
	}

	function handlePlay() { playing = true; }
	function handlePause() { playing = false; }

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
			case 'i':
				if (videoEl) onSetIn?.(videoEl.currentTime);
				break;
			case 'o':
				if (videoEl) onSetOut?.(videoEl.currentTime);
				break;
			case ',':
				e.preventDefault();
				seek(-1);
				break;
			case '.':
				e.preventDefault();
				seek(1);
				break;
			case 'f':
				toggleFullscreen();
				break;
		}
	}

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		const ms = Math.floor((seconds % 1) * 100);
		return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
	}

	let dragging = $state(false);
	let wasPlayingBeforeDrag = false;
	let pendingSeek: number | null = null;
	let seekRaf = 0;

	function seekToPosition(clientX: number, el: HTMLElement) {
		if (!videoEl) return;
		const rect = el.getBoundingClientRect();
		const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		const target = hasClipRange ? rangeStart + pct * rangeDuration : pct * duration;

		// Throttle to requestAnimationFrame for smooth scrubbing
		pendingSeek = target;
		if (!seekRaf) {
			seekRaf = requestAnimationFrame(() => {
				if (videoEl && pendingSeek !== null) {
					videoEl.currentTime = pendingSeek;
					currentTime = pendingSeek;
					pendingSeek = null;
				}
				seekRaf = 0;
			});
		}
	}

	function handleTimelineDown(e: MouseEvent | TouchEvent) {
		e.preventDefault();
		const el = e.currentTarget as HTMLElement;
		const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
		dragging = true;
		wasPlayingBeforeDrag = !videoEl?.paused;
		if (videoEl) videoEl.pause();
		seekToPosition(clientX, el);

		function onMove(ev: MouseEvent | TouchEvent) {
			if (!dragging) return;
			ev.preventDefault();
			const cx = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
			seekToPosition(cx, el);
		}

		function onUp() {
			dragging = false;
			if (seekRaf) { cancelAnimationFrame(seekRaf); seekRaf = 0; }
			// Apply any pending seek immediately
			if (videoEl && pendingSeek !== null) {
				videoEl.currentTime = pendingSeek;
				pendingSeek = null;
			}
			if (wasPlayingBeforeDrag && videoEl) videoEl.play();
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			window.removeEventListener('touchmove', onMove);
			window.removeEventListener('touchend', onUp);
		}

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		window.addEventListener('touchmove', onMove, { passive: false });
		window.addEventListener('touchend', onUp);
	}

	function handleTimelineHover(e: MouseEvent) {
		if (dragging) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		if (hasClipRange) {
			hoverTime = pct * rangeDuration;
		} else {
			hoverTime = pct * duration;
		}
	}

	function clipPosition(time: number): number {
		if (hasClipRange) {
			return rangeDuration > 0 ? ((time - rangeStart) / rangeDuration) * 100 : 0;
		}
		return duration > 0 ? (time / duration) * 100 : 0;
	}

	const rates = [0.25, 0.5, 0.75, 1, 1.5, 2];
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="player" bind:this={playerEl} class:fake-fullscreen={fakeFullscreen}>
	<div class="video-container" role="button" tabindex="-1" onclick={togglePlay}>
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={videoEl}
			{src}
			playsinline
			ontimeupdate={handleTimeUpdate}
			onloadedmetadata={handleLoadedMetadata}
			onplay={handlePlay}
			onpause={handlePause}
			preload="metadata"
		></video>
	</div>

	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="timeline"
		bind:this={timelineEl}
		role="slider"
		tabindex="0"
		aria-valuenow={currentTime}
		aria-valuemin={0}
		aria-valuemax={duration}
		onmousedown={handleTimelineDown}
		ontouchstart={handleTimelineDown}
		onmousemove={handleTimelineHover}
		onmouseleave={() => { if (!dragging) hoverTime = null; }}
	>
		<div class="timeline-track">
			{#if hasClipRange}
				<div
					class="timeline-clip-region"
					style="left: {rangeDuration > 0 ? ((clipStart - rangeStart) / rangeDuration) * 100 : 0}%; width: {rangeDuration > 0 ? ((clipEnd - clipStart) / rangeDuration) * 100 : 0}%"
				></div>
			{/if}
			{#each clips as clip}
				<div
					class="timeline-clip"
					style="left: {clipPosition(clip.startTime)}%; width: {Math.max(0.5, clipPosition(clip.endTime) - clipPosition(clip.startTime))}%"
					title={clip.label}
				></div>
			{/each}
			<div class="timeline-progress" style="width: {rangeDuration > 0 ? ((currentTime - rangeStart) / rangeDuration) * 100 : (duration > 0 ? (currentTime / duration) * 100 : 0)}%"></div>
			<div class="timeline-head" style="left: {rangeDuration > 0 ? ((currentTime - rangeStart) / rangeDuration) * 100 : (duration > 0 ? (currentTime / duration) * 100 : 0)}%"></div>
			{#if hoverTime !== null}
				<div class="timeline-hover" style="left: {rangeDuration > 0 ? (hoverTime / rangeDuration) * 100 : (duration > 0 ? (hoverTime / duration) * 100 : 0)}%">
					<span class="hover-time">{formatTime(hoverTime)}</span>
				</div>
			{/if}
		</div>
	</div>

	<div class="controls">
		<div class="controls-group">
			<button class="ctrl-btn play-btn" onclick={togglePlay} title={playing ? 'Pause' : 'Play'}>
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

			{#if hasClipRange}
				<button class="ctrl-btn buffer-btn" class:active={showPreBuffer} onclick={() => showPreBuffer = !showPreBuffer} title="Show 10s before clip">-10s</button>
				<button class="ctrl-btn buffer-btn" class:active={showPostBuffer} onclick={() => showPostBuffer = !showPostBuffer} title="Show 10s after clip">+10s</button>
			{/if}

			<div class="seek-group">
				<button class="ctrl-btn" onclick={() => seek(-5)} title="Back 5s">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" /></svg>
				</button>
				<button class="ctrl-btn" onclick={() => seek(-1)} title="Back 1s">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg>
				</button>
				<button class="ctrl-btn" onclick={() => seek(1)} title="Forward 1s">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6" /></svg>
				</button>
				<button class="ctrl-btn" onclick={() => seek(5)} title="Forward 5s">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" /></svg>
				</button>
			</div>

			<span class="time">{formatTime(hasClipRange ? currentTime - rangeStart : currentTime)}<span class="time-sep">/</span>{formatTime(hasClipRange ? rangeDuration : duration)}</span>
		</div>

		<div class="controls-group">
			<div class="rate-group">
				{#each rates as rate}
					<button
						class="rate-btn"
						class:active={playbackRate === rate}
						onclick={() => setRate(rate)}
					>{rate}x</button>
				{/each}
			</div>

			<div class="mark-group">
				<button class="mark-btn mark-in" onclick={() => { if (videoEl) onSetIn?.(videoEl.currentTime); }} title="Set in-point (i)">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6" /><line x1="9" y1="6" x2="9" y2="18" /></svg>
					IN
				</button>
				<button class="mark-btn mark-out" onclick={() => { if (videoEl) onSetOut?.(videoEl.currentTime); }} title="Set out-point (o)">
					OUT
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6" /><line x1="15" y1="6" x2="15" y2="18" /></svg>
				</button>
			</div>

			<button class="ctrl-btn fullscreen-btn" onclick={toggleFullscreen} title="Fullscreen (f)">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
					<line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
				</svg>
			</button>
		</div>
	</div>
</div>

<style>
	.player {
		width: 100%;
		background: #0f0f12;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.04);
	}

	.video-container {
		cursor: pointer;
		line-height: 0;
	}

	video {
		width: 100%;
		display: block;
		max-height: 60vh;
		object-fit: contain;
		background: #000;
	}

	.timeline {
		position: relative;
		height: 32px;
		cursor: pointer;
		padding: 10px 0;
		background: #0f0f12;
		touch-action: none;
		user-select: none;
	}

	.timeline-track {
		position: relative;
		height: 4px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 2px;
		margin: 0 12px;
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
		transition: width 0.05s linear;
	}

	.timeline-head {
		position: absolute;
		top: 50%;
		width: 14px;
		height: 14px;
		background: #c7d2fe;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.1s;
		cursor: grab;
		box-shadow: 0 0 8px rgba(129, 140, 248, 0.5);
	}

	.timeline:hover .timeline-head {
		opacity: 1;
	}

	.timeline-clip-region {
		position: absolute;
		top: 0;
		height: 100%;
		background: rgba(99, 102, 241, 0.12);
		border-left: 2px solid rgba(99, 102, 241, 0.5);
		border-right: 2px solid rgba(99, 102, 241, 0.5);
		pointer-events: none;
	}

	.timeline-clip {
		position: absolute;
		top: -2px;
		height: calc(100% + 4px);
		background: rgba(99, 102, 241, 0.2);
		border: 1px solid rgba(99, 102, 241, 0.35);
		border-radius: 2px;
		pointer-events: none;
	}

	.timeline-hover {
		position: absolute;
		top: -28px;
		transform: translateX(-50%);
		pointer-events: none;
	}

	.hover-time {
		background: #27272a;
		color: #d4d4d8;
		font-size: 11px;
		padding: 3px 7px;
		border-radius: 4px;
		font-family: 'Inter', monospace;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		border: 1px solid rgba(255, 255, 255, 0.06);
	}

	.controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px 10px;
		gap: 12px;
		flex-wrap: wrap;
	}

	.controls-group {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.buffer-btn {
		font-size: 11px !important;
		padding: 4px 8px !important;
		min-width: unset !important;
		min-height: unset !important;
		border: 1px solid rgba(255, 255, 255, 0.1) !important;
	}

	.buffer-btn.active {
		background: rgba(99, 102, 241, 0.2) !important;
		color: #818cf8 !important;
		border-color: rgba(99, 102, 241, 0.4) !important;
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

	.seek-group {
		display: flex;
		gap: 1px;
	}

	.time {
		font-family: 'Inter', monospace;
		font-size: 12px;
		color: #71717a;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.01em;
		margin-left: 4px;
	}

	.time-sep {
		color: #3f3f46;
		margin: 0 3px;
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
		padding: 4px 8px;
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

	.mark-group {
		display: flex;
		gap: 4px;
		margin-left: 8px;
	}

	.mark-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		background: rgba(99, 102, 241, 0.1);
		color: #818cf8;
		border: 1px solid rgba(99, 102, 241, 0.2);
		padding: 5px 10px;
		border-radius: 6px;
		cursor: pointer;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		transition: all 0.15s;
		font-family: 'Inter', sans-serif;
	}

	.mark-btn:hover {
		background: rgba(99, 102, 241, 0.18);
		border-color: rgba(99, 102, 241, 0.35);
	}

	.loop-toggle.active {
		color: #818cf8;
	}

	.loop-toggle:not(.active) {
		color: #3f3f46;
	}

	.fullscreen-btn {
		margin-left: 4px;
	}

	:global(.player:fullscreen),
	.fake-fullscreen {
		background: #000;
		display: flex;
		flex-direction: column;
	}

	:global(.player:fullscreen video),
	.fake-fullscreen video {
		flex: 1;
		max-height: 100vh;
		max-width: 100vw;
		object-fit: contain;
	}

	.fake-fullscreen {
		position: fixed;
		inset: 0;
		z-index: 9999;
	}

	@media (max-width: 640px) {
		.controls {
			justify-content: center;
		}
		.controls-group {
			flex-wrap: wrap;
			justify-content: center;
		}
		.rate-group {
			display: none;
		}
	}
</style>
