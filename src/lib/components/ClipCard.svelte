<script lang="ts">
	import type { ClipMeta } from '$lib/store.svelte';
	import * as store from '$lib/store.svelte';
	import { extractClip } from '$lib/ffmpeg';

	let {
		clip,
		onDelete
	}: {
		clip: ClipMeta;
		onDelete?: () => void;
	} = $props();

	let thumbnailUrl = $state<string | null>(null);
	let videoUrl = $state<string | null>(null);
	let showVideo = $state(false);
	let looping = $state(true);
	let playing = $state(false);
	let videoEl: HTMLVideoElement | undefined = $state();
	let downloading = $state(false);

	function togglePlay(e: Event) {
		e.preventDefault();
		if (!videoEl) return;
		if (videoEl.paused) {
			videoEl.currentTime = Math.max(clip.startTime, Math.min(videoEl.currentTime, clip.endTime));
			videoEl.play();
		} else {
			videoEl.pause();
		}
	}

	function handleTimeUpdate() {
		if (!videoEl) return;
		if (videoEl.currentTime >= clip.endTime) {
			if (looping) {
				videoEl.currentTime = clip.startTime;
				videoEl.play();
			} else {
				videoEl.pause();
				videoEl.currentTime = clip.endTime;
			}
		}
	}

	let editing = $state(false);
	let editLabel = $state(clip.label);
	let editTags = $state(clip.tags.join(', '));

	// Generate thumbnail on-the-fly by seeking a hidden video to startTime
	$effect(() => {
		let cancelled = false;
		let url: string | null = null;

		store.getVideoBlob(clip.videoId).then((blob) => {
			if (cancelled) return;
			const video = document.createElement('video');
			video.muted = true;
			video.preload = 'metadata';
			video.onloadedmetadata = () => {
				video.currentTime = clip.startTime;
			};
			video.onseeked = () => {
				try {
					const canvas = document.createElement('canvas');
					canvas.width = video.videoWidth;
					canvas.height = video.videoHeight;
					const ctx = canvas.getContext('2d');
					if (ctx) {
						ctx.drawImage(video, 0, 0);
						canvas.toBlob((b) => {
							URL.revokeObjectURL(video.src);
							if (b && !cancelled) {
								url = URL.createObjectURL(b);
								thumbnailUrl = url;
							}
						}, 'image/jpeg', 0.8);
					} else {
						URL.revokeObjectURL(video.src);
					}
				} catch {
					URL.revokeObjectURL(video.src);
				}
			};
			video.onerror = () => {
				URL.revokeObjectURL(video.src);
			};
			video.src = URL.createObjectURL(blob);
		}).catch(() => {});

		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	});

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	async function play() {
		const blob = await store.getVideoBlob(clip.videoId);
		videoUrl = URL.createObjectURL(blob);
		showVideo = true;
	}

	function handleVideoLoaded() {
		if (videoEl) {
			videoEl.currentTime = clip.startTime;
		}
	}

	function stopVideo() {
		showVideo = false;
		playing = false;
		if (videoUrl) {
			URL.revokeObjectURL(videoUrl);
			videoUrl = null;
		}
	}

	async function download() {
		downloading = true;
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
			downloading = false;
		}
	}

	async function saveEdit() {
		const tagList = editTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
		await store.updateClip(clip.id, { label: editLabel.trim(), tags: tagList });
		editing = false;
	}

	async function deleteClip() {
		if (confirm('Delete this clip?')) {
			await store.deleteClip(clip.id);
			onDelete?.();
		}
	}
</script>

<a href="/clips/{clip.id}" class="clip-card">
	{#if showVideo && videoUrl}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="video-wrapper" onclick={togglePlay}>
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				bind:this={videoEl}
				src={videoUrl}
				autoplay
				onplay={() => playing = true}
				onpause={() => playing = false}
				ontimeupdate={handleTimeUpdate}
				onloadedmetadata={handleVideoLoaded}
			></video>
			{#if !playing}
				<div class="pause-overlay">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
				</div>
			{/if}
			<div class="video-controls-overlay" onclick={(e) => e.stopPropagation()}>
				<button class="loop-btn" class:active={looping} onclick={(e) => { e.preventDefault(); looping = !looping; }} title={looping ? 'Looping on' : 'Looping off'}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
						<polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
					</svg>
				</button>
				<button class="close-btn" onclick={(e) => { e.preventDefault(); stopVideo(); }} title="Close">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>
		</div>
	{:else}
		<button class="thumbnail" onclick={(e) => { e.preventDefault(); play(); }}>
			{#if thumbnailUrl}
				<img src={thumbnailUrl} alt={clip.label} />
			{:else}
				<div class="no-thumb">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
				</div>
			{/if}
			<div class="thumb-overlay">
				<div class="play-circle">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
				</div>
			</div>
			<span class="duration">{formatTime(clip.endTime - clip.startTime)}</span>
		</button>
	{/if}

	<div class="info">
		{#if editing}
			<input type="text" bind:value={editLabel} class="edit-input" placeholder="Move name" />
			<input type="text" bind:value={editTags} class="edit-input" placeholder="Tags (comma-separated)" />
			<div class="actions">
				<button class="action-btn save" onclick={saveEdit}>Save</button>
				<button class="action-btn" onclick={() => editing = false}>Cancel</button>
			</div>
		{:else}
			<a href="/clips/{clip.id}" class="clip-title"><h4>{clip.label}</h4></a>
			<div class="badges">
				{#if clip.dance}<span class="badge dance">{clip.dance}</span>{/if}
				{#if clip.clipType}<span class="badge type">{clip.clipType}</span>{/if}
				{#if clip.style}<span class="badge style">{clip.style}</span>{/if}
				{#if clip.mastery}<span class="badge mastery">{clip.mastery}</span>{/if}
			</div>
			{#if clip.lead || clip.follow}
				<p class="dancers">{clip.lead || '?'} & {clip.follow || '?'}</p>
			{/if}
			{#if clip.tags.length > 0}
				<div class="tags">
					{#each clip.tags as tag}
						<span class="tag">{tag}</span>
					{/each}
				</div>
			{/if}
			<p class="meta">{clip.videoName} - {formatTime(clip.startTime)} to {formatTime(clip.endTime)}</p>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="actions" onclick={(e) => e.preventDefault()}>
				<button class="action-btn" onclick={download} title="Download as mp4" disabled={downloading}>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
					</svg>
					{downloading ? 'Extracting...' : 'Download'}
				</button>
				<button class="action-btn danger" onclick={deleteClip}>Delete</button>
			</div>
		{/if}
	</div>
</a>

<style>
	.clip-card {
		display: block;
		background: #18181b;
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.04);
		transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
		text-decoration: none;
		color: inherit;
		cursor: pointer;
	}

	.clip-card:hover {
		border-color: rgba(255, 255, 255, 0.08);
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
	}

	.thumbnail {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		border: none;
		padding: 0;
		cursor: pointer;
		display: block;
		background: #0f0f12;
		overflow: hidden;
	}

	.thumbnail img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.3s;
	}

	.thumbnail:hover img {
		transform: scale(1.03);
	}

	.no-thumb {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #27272a;
	}

	.thumb-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0);
		transition: background 0.2s;
	}

	.thumbnail:hover .thumb-overlay {
		background: rgba(0, 0, 0, 0.3);
	}

	.play-circle {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.15);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		color: #fff;
		opacity: 0;
		transform: scale(0.9);
		transition: opacity 0.2s, transform 0.2s;
	}

	.play-circle svg {
		margin-left: 2px;
	}

	.thumbnail:hover .play-circle {
		opacity: 1;
		transform: scale(1);
	}

	.duration {
		position: absolute;
		bottom: 6px;
		right: 6px;
		background: rgba(0, 0, 0, 0.75);
		color: #d4d4d8;
		font-size: 11px;
		padding: 2px 6px;
		border-radius: 4px;
		font-family: 'Inter', monospace;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.video-wrapper {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		background: #000;
		cursor: pointer;
	}

	.video-wrapper video {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.pause-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.3);
		color: #fff;
		pointer-events: none;
	}

	.video-controls-overlay {
		position: absolute;
		top: 8px;
		right: 8px;
		display: flex;
		gap: 6px;
	}

	.close-btn, .loop-btn {
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		color: #d4d4d8;
		border: none;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s, color 0.15s;
	}

	.close-btn:hover, .loop-btn:hover {
		background: rgba(0, 0, 0, 0.8);
	}

	.loop-btn.active {
		color: #818cf8;
	}

	.loop-btn:not(.active) {
		color: #52525b;
	}

	.info {
		padding: 12px 14px 14px;
	}

	.clip-title {
		text-decoration: none;
	}

	.clip-title:hover h4 {
		color: #818cf8;
	}

	h4 {
		margin: 0 0 6px;
		color: #e4e4e7;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.01em;
		transition: color 0.15s;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 6px;
	}

	.badge {
		padding: 2px 7px;
		border-radius: 4px;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.badge.dance {
		background: rgba(251, 191, 36, 0.12);
		color: #fbbf24;
	}

	.badge.type {
		background: rgba(99, 102, 241, 0.12);
		color: #818cf8;
	}

	.badge.style {
		background: rgba(244, 114, 182, 0.12);
		color: #f472b6;
	}

	.badge.mastery {
		background: rgba(52, 211, 153, 0.12);
		color: #34d399;
	}

	.dancers {
		color: #a1a1aa;
		font-size: 12px;
		font-weight: 500;
		margin: 0 0 4px;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 6px;
	}

	.tag {
		background: rgba(255, 255, 255, 0.04);
		color: #71717a;
		padding: 2px 8px;
		border-radius: 10px;
		font-size: 11px;
		font-weight: 500;
	}

	.meta {
		color: #52525b;
		font-size: 11px;
		margin: 0 0 8px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.actions {
		display: flex;
		gap: 6px;
		margin-top: 10px;
	}

	.action-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		background: rgba(255, 255, 255, 0.04);
		color: #a1a1aa;
		border: 1px solid rgba(255, 255, 255, 0.06);
		padding: 5px 10px;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
		text-decoration: none;
	}

	.action-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
	}

	.action-btn.save {
		background: rgba(99, 102, 241, 0.1);
		color: #818cf8;
		border-color: rgba(99, 102, 241, 0.2);
	}

	.action-btn.save:hover {
		background: rgba(99, 102, 241, 0.18);
	}

	.action-btn.danger {
		color: #71717a;
	}

	.action-btn.danger:hover {
		color: #ef4444;
		background: rgba(239, 68, 68, 0.06);
		border-color: rgba(239, 68, 68, 0.15);
	}

	.edit-input {
		width: 100%;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #e4e4e7;
		padding: 8px 10px;
		border-radius: 6px;
		font-size: 12px;
		font-family: 'Inter', sans-serif;
		margin-bottom: 6px;
		box-sizing: border-box;
		transition: border-color 0.15s;
	}

	.edit-input:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
	}
</style>
