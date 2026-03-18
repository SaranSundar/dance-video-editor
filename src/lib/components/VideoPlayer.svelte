<script lang="ts">
	import type { ClipMeta } from '$lib/store.svelte';

	let {
		src,
		currentTime = $bindable(0),
		duration = $bindable(0),
		clips = [],
		onSetIn,
		onSetOut
	}: {
		src: string;
		currentTime?: number;
		duration?: number;
		clips?: ClipMeta[];
		onSetIn?: (time: number) => void;
		onSetOut?: (time: number) => void;
	} = $props();

	let videoEl: HTMLVideoElement | undefined = $state();
	let playerEl: HTMLElement | undefined = $state();
	let playing = $state(false);
	let playbackRate = $state(1);
	let hoverTime = $state<number | null>(null);

	function toggleFullscreen() {
		if (!playerEl) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			playerEl.requestFullscreen();
		}
	}
	let timelineEl: HTMLElement | undefined = $state();

	function togglePlay() {
		if (!videoEl) return;
		if (videoEl.paused) {
			videoEl.play();
		} else {
			videoEl.pause();
		}
	}

	function seek(delta: number) {
		if (!videoEl) return;
		videoEl.currentTime = Math.max(0, Math.min(duration, videoEl.currentTime + delta));
	}

	function setRate(rate: number) {
		playbackRate = rate;
		if (videoEl) videoEl.playbackRate = rate;
	}

	function handleTimeUpdate() {
		if (videoEl) currentTime = videoEl.currentTime;
	}

	function handleLoadedMetadata() {
		if (videoEl) duration = videoEl.duration;
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
		const ms = Math.floor((seconds % 1) * 100);
		return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
	}

	function handleTimelineClick(e: MouseEvent) {
		if (!videoEl) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const pct = (e.clientX - rect.left) / rect.width;
		videoEl.currentTime = Math.max(0, pct * duration);
	}

	function handleTimelineHover(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const pct = (e.clientX - rect.left) / rect.width;
		hoverTime = Math.max(0, pct * duration);
	}

	function clipPosition(time: number): number {
		return duration > 0 ? (time / duration) * 100 : 0;
	}

	const rates = [0.25, 0.5, 0.75, 1, 1.5, 2];
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="player" bind:this={playerEl}>
	<div class="video-container" role="button" tabindex="-1" onclick={togglePlay}>
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={videoEl}
			{src}
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
		onclick={handleTimelineClick}
		onmousemove={handleTimelineHover}
		onmouseleave={() => hoverTime = null}
	>
		<div class="timeline-track">
			{#each clips as clip}
				<div
					class="timeline-clip"
					style="left: {clipPosition(clip.startTime)}%; width: {Math.max(0.5, clipPosition(clip.endTime) - clipPosition(clip.startTime))}%"
					title={clip.label}
				></div>
			{/each}
			<div class="timeline-progress" style="width: {duration > 0 ? (currentTime / duration) * 100 : 0}%"></div>
			<div class="timeline-head" style="left: {duration > 0 ? (currentTime / duration) * 100 : 0}%"></div>
			{#if hoverTime !== null}
				<div class="timeline-hover" style="left: {duration > 0 ? (hoverTime / duration) * 100 : 0}%">
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

			<div class="seek-group">
				<button class="ctrl-btn" onclick={() => seek(-5)} title="Back 5s">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" /></svg>
				</button>
				<button class="ctrl-btn" onclick={() => seek(-1/30)} title="Previous frame">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg>
				</button>
				<button class="ctrl-btn" onclick={() => seek(1/30)} title="Next frame">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6" /></svg>
				</button>
				<button class="ctrl-btn" onclick={() => seek(5)} title="Forward 5s">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" /></svg>
				</button>
			</div>

			<span class="time">{formatTime(currentTime)}<span class="time-sep">/</span>{formatTime(duration)}</span>
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

	.fullscreen-btn {
		margin-left: 4px;
	}

	:global(.player:fullscreen) {
		background: #000;
		display: flex;
		flex-direction: column;
	}

	:global(.player:fullscreen video) {
		flex: 1;
		max-height: none;
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
