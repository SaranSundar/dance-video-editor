<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import * as store from '$lib/store.svelte';
	import type { ClipMeta } from '$lib/store.svelte';

	let practiceId = $derived($page.params.id);
	let practice = $derived(store.getPractices().find(p => p.id === practiceId));
	let allClips = $derived(store.getClips());

	// Resolved clips in order (filter out deleted clips)
	let sessionClips = $derived(
		(practice?.clipIds ?? [])
			.map(id => allClips.find(c => c.id === id))
			.filter((c): c is ClipMeta => c != null)
	);

	let totalDuration = $derived(
		sessionClips.reduce((sum, c) => sum + (c.endTime - c.startTime), 0)
	);

	// Editing
	let editingName = $state(false);
	let nameInput = $state('');

	function startEditName() {
		nameInput = practice?.name ?? '';
		editingName = true;
	}

	async function saveName() {
		if (!practice || !nameInput.trim()) return;
		await store.updatePractice(practice.id, { name: nameInput.trim() });
		editingName = false;
	}

	// Clip picker
	let showPicker = $state(false);
	let pickerSearch = $state('');
	let pickerTypeFilter = $state('');
	const clipTypes = ['move', 'pattern', 'styling', 'footwork', 'musicality'];
	let pickerClips = $derived(
		allClips
			.filter(c => !c.hidden && !c.hiddenFromSearch)
			.filter(c => !pickerTypeFilter || c.clipType === pickerTypeFilter)
			.filter(c => {
				if (!pickerSearch) return true;
				const q = pickerSearch.toLowerCase();
				return c.label.toLowerCase().includes(q)
					|| c.tags.some(t => t.includes(q))
					|| c.lead.toLowerCase().includes(q)
					|| c.follow.toLowerCase().includes(q)
					|| c.dance.toLowerCase().includes(q)
					|| c.videoName.toLowerCase().includes(q);
			})
	);

	async function addClipToSession(clipId: string) {
		if (!practice) return;
		const newIds = [...practice.clipIds, clipId];
		await store.updatePractice(practice.id, { clipIds: newIds });
	}

	async function removeClipFromSession(index: number) {
		if (!practice) return;
		const newIds = practice.clipIds.filter((_, i) => i !== index);
		await store.updatePractice(practice.id, { clipIds: newIds });
	}

	async function toggleLoop() {
		if (!practice) return;
		await store.updatePractice(practice.id, { loop: !practice.loop });
	}

	// Drag and drop reorder
	let dragIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	function handleDragStart(index: number, e: DragEvent) {
		dragIndex = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(index));
		}
	}

	function handleDragOver(index: number, e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		dragOverIndex = index;
	}

	function handleDragLeave() {
		dragOverIndex = null;
	}

	async function handleDrop(index: number, e: DragEvent) {
		e.preventDefault();
		if (!practice || dragIndex === null || dragIndex === index) {
			dragIndex = null;
			dragOverIndex = null;
			return;
		}

		const newIds = [...practice.clipIds];
		const [moved] = newIds.splice(dragIndex, 1);
		newIds.splice(index, 0, moved);
		await store.updatePractice(practice.id, { clipIds: newIds });

		dragIndex = null;
		dragOverIndex = null;
	}

	function handleDragEnd() {
		dragIndex = null;
		dragOverIndex = null;
	}

	// Touch drag support
	let touchDragIndex = $state<number | null>(null);
	let touchStartY = $state(0);

	function handleTouchStart(index: number, e: TouchEvent) {
		touchDragIndex = index;
		touchStartY = e.touches[0].clientY;
	}

	async function handleTouchEnd(e: TouchEvent) {
		if (touchDragIndex === null || !practice) {
			touchDragIndex = null;
			return;
		}
		const endY = e.changedTouches[0].clientY;
		const diff = endY - touchStartY;
		const threshold = 40;

		if (Math.abs(diff) > threshold) {
			const direction = diff > 0 ? 1 : -1;
			const newIndex = Math.max(0, Math.min(practice.clipIds.length - 1, touchDragIndex + direction));
			if (newIndex !== touchDragIndex) {
				const newIds = [...practice.clipIds];
				const [moved] = newIds.splice(touchDragIndex, 1);
				newIds.splice(newIndex, 0, moved);
				await store.updatePractice(practice.id, { clipIds: newIds });
			}
		}
		touchDragIndex = null;
	}

	// Sequential player
	let playing = $state(false);
	let currentIndex = $state(0);
	let videoEl = $state<HTMLVideoElement | undefined>();
	let playerWrapperEl = $state<HTMLDivElement | undefined>();
	let videoUrl = $state<string | null>(null);
	let revokeUrl = $state<(() => void) | null>(null);
	let playerVisible = $state(false);
	let playbackSpeed = $state(1);
	let clipProgress = $state(0);
	let currentVideoId = $state<string | null>(null);
	let fakeFullscreen = $state(false);

	function toggleFullscreen(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		if (!playerWrapperEl) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else if (typeof playerWrapperEl.requestFullscreen === 'function') {
			playerWrapperEl.requestFullscreen().catch(() => {
				fakeFullscreen = !fakeFullscreen;
			});
		} else {
			fakeFullscreen = !fakeFullscreen;
		}
	}

	const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

	let needsSeek = $state(false);

	function startPlayback(fromIndex = 0) {
		if (sessionClips.length === 0) return;
		currentIndex = fromIndex;
		clipProgress = 0;
		playerVisible = true;
		setClipSource(fromIndex);
	}

	function setClipSource(index: number) {
		if (index >= sessionClips.length) {
			if (practice?.loop) {
				currentIndex = 0;
				setClipSource(0);
			} else {
				stopPlayback();
			}
			return;
		}

		currentIndex = index;
		clipProgress = 0;
		const clip = sessionClips[index];

		// Same video — just seek, don't reload
		if (currentVideoId === clip.videoId && videoEl) {
			videoEl.currentTime = clip.startTime;
			videoEl.playbackRate = playbackSpeed;
			videoEl.play().catch(() => {});
			playing = true;
			return;
		}

		// Different video — set src, flag for seek on load
		if (revokeUrl) { revokeUrl(); revokeUrl = null; }
		const cdnUrl = store.getCdnUrlForVideo(clip.videoId);
		if (cdnUrl) {
			currentVideoId = clip.videoId;
			needsSeek = true;
			videoUrl = cdnUrl;
		}
	}

	function handleVideoLoaded() {
		if (!videoEl || !needsSeek) return;
		needsSeek = false;
		const clip = sessionClips[currentIndex];
		if (clip) {
			videoEl.playbackRate = playbackSpeed;
			videoEl.currentTime = clip.startTime;
			// autoplay attribute handles playing — don't call play() here
		}
	}

	function handleTimeUpdate() {
		if (!videoEl) return;
		const clip = sessionClips[currentIndex];
		if (!clip) return;
		if (videoEl.currentTime >= clip.endTime) {
			setClipSource(currentIndex + 1);
			return;
		}
		// Update progress
		const elapsed = videoEl.currentTime - clip.startTime;
		const duration = clip.endTime - clip.startTime;
		clipProgress = duration > 0 ? (elapsed / duration) * 100 : 0;
	}

	function togglePlayPause(e: Event) {
		e.preventDefault();
		if (!videoEl) return;
		if (videoEl.paused) {
			const clip = sessionClips[currentIndex];
			if (clip) {
				videoEl.currentTime = Math.max(clip.startTime, Math.min(videoEl.currentTime, clip.endTime));
			}
			videoEl.play();
		} else {
			videoEl.pause();
		}
	}

	function seekClip(e: MouseEvent) {
		if (!videoEl) return;
		const clip = sessionClips[currentIndex];
		if (!clip) return;
		const bar = e.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		const duration = clip.endTime - clip.startTime;
		videoEl.currentTime = clip.startTime + pct * duration;
	}

	function setSpeed(speed: number) {
		playbackSpeed = speed;
		if (videoEl) videoEl.playbackRate = speed;
	}

	function stopPlayback() {
		playing = false;
		playerVisible = false;
		currentVideoId = null;
		clipProgress = 0;
		needsSeek = false;
		if (revokeUrl) { revokeUrl(); revokeUrl = null; }
		videoUrl = null;
	}

	function skipToClip(index: number) {
		setClipSource(index);
	}

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}
</script>

{#if !practice}
	<div class="not-found">
		<p>Practice session not found.</p>
		<a href="/practice">Back to sessions</a>
	</div>
{:else}
	<div class="page">
		<div class="top-bar">
			<a href="/practice" class="back-link">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="15 18 9 12 15 6" />
				</svg>
				Sessions
			</a>
		</div>

		<div class="header">
			{#if editingName}
				<form onsubmit={(e) => { e.preventDefault(); saveName(); }} class="name-form">
					<!-- svelte-ignore a11y_autofocus -->
					<input type="text" bind:value={nameInput} class="name-input" autofocus />
					<button type="submit" class="save-btn">Save</button>
					<button type="button" class="cancel-btn" onclick={() => editingName = false}>Cancel</button>
				</form>
			{:else}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<h1 onclick={startEditName} class="editable-name">{practice.name}</h1>
			{/if}

			<div class="header-meta">
				<span>{sessionClips.length} clip{sessionClips.length === 1 ? '' : 's'}</span>
				<span class="dot"></span>
				<span>{formatTime(totalDuration)}</span>
			</div>
		</div>

		<div class="controls">
			<button class="play-all-btn" onclick={() => startPlayback(0)} disabled={sessionClips.length === 0}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
				Play All
			</button>
			<button class="control-btn" class:active={practice.loop} onclick={toggleLoop} title="Loop session">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
					<polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
				</svg>
				Loop
			</button>
			<button class="control-btn add-btn" onclick={() => showPicker = !showPicker}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
					<line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
				</svg>
				Add Clips
			</button>
		</div>

		<!-- Player -->
		{#if playerVisible && videoUrl}
			<div class="player-section">
				<div class="player-header">
					<span class="now-playing">
						Playing {currentIndex + 1}/{sessionClips.length}: <strong>{sessionClips[currentIndex]?.label}</strong>
					</span>
					<button class="close-player" onclick={stopPlayback}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
					</button>
				</div>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="player-wrapper" bind:this={playerWrapperEl} class:fake-fullscreen={fakeFullscreen} onclick={togglePlayPause}>
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						bind:this={videoEl}
						autoplay
						playsinline
						onplay={() => playing = true}
						onpause={() => playing = false}
						ontimeupdate={handleTimeUpdate}
						onloadedmetadata={handleVideoLoaded}
						src={videoUrl}
					></video>
					{#if !playing}
						<div class="pause-overlay">
							<svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
						</div>
					{/if}
				</div>
				<div class="player-controls" onclick={(e) => e.stopPropagation()}>
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="progress-bar" onclick={seekClip}>
						<div class="progress-fill" style="width: {clipProgress}%"></div>
					</div>
					<div class="controls-row">
						<div class="controls-left">
							<button class="ctrl-btn" onclick={togglePlayPause}>
								{#if playing}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
								{:else}
									<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
								{/if}
							</button>
							{#if currentIndex > 0}
								<button class="ctrl-btn" onclick={() => skipToClip(currentIndex - 1)} title="Previous clip">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="19 20 9 12 19 4" /><line x1="5" y1="4" x2="5" y2="20" /></svg>
								</button>
							{/if}
							{#if currentIndex < sessionClips.length - 1}
								<button class="ctrl-btn" onclick={() => skipToClip(currentIndex + 1)} title="Next clip">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="5 4 15 12 5 20" /><line x1="19" y1="4" x2="19" y2="20" /></svg>
								</button>
							{/if}
						</div>
						<div class="controls-right">
							<select class="speed-select" value={playbackSpeed} onchange={(e) => setSpeed(Number((e.target as HTMLSelectElement).value))}>
								{#each speeds as s}
									<option value={s}>{s}x</option>
								{/each}
							</select>
							<button class="ctrl-btn" onclick={toggleFullscreen} title="Fullscreen">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
									<path d="M3 7V3h4M21 7V3h-4M3 17v4h4M21 17v4h-4" />
								</svg>
							</button>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Clip picker -->
		{#if showPicker}
			<div class="picker">
				<div class="picker-header">
					<input type="text" bind:value={pickerSearch} placeholder="Search clips..." class="picker-search" />
					<select bind:value={pickerTypeFilter} class="picker-type-filter">
						<option value="">All types</option>
						{#each clipTypes as t}
							<option value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
						{/each}
					</select>
					<button class="picker-close" onclick={() => showPicker = false}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
					</button>
				</div>
				<div class="picker-list">
					{#each pickerClips as clip (clip.id)}
						<button class="picker-item" onclick={() => addClipToSession(clip.id)}>
							<div class="picker-item-info">
								<span class="picker-item-label">{clip.label}</span>
								<span class="picker-item-meta">
									{clip.videoName} - {formatTime(clip.startTime)} to {formatTime(clip.endTime)}
									{#if clip.dance}<span class="picker-badge">{clip.dance}</span>{/if}
								</span>
							</div>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
								<line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
							</svg>
						</button>
					{/each}
					{#if pickerClips.length === 0}
						<p class="picker-empty">No clips found</p>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Clip list with drag-and-drop -->
		{#if sessionClips.length === 0 && !showPicker}
			<div class="empty-list">
				<p>No clips added yet. Click "Add Clips" to build your practice.</p>
			</div>
		{:else}
			<div class="clip-list">
				{#each sessionClips as clip, i (practice.clipIds[i])}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="clip-row"
						class:dragging={dragIndex === i}
						class:drag-over={dragOverIndex === i}
						class:playing-now={playerVisible && currentIndex === i}
						draggable="true"
						ondragstart={(e) => handleDragStart(i, e)}
						ondragover={(e) => handleDragOver(i, e)}
						ondragleave={handleDragLeave}
						ondrop={(e) => handleDrop(i, e)}
						ondragend={handleDragEnd}
						ontouchstart={(e) => handleTouchStart(i, e)}
						ontouchend={handleTouchEnd}
					>
						<div class="drag-handle" title="Drag to reorder">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
								<circle cx="9" cy="6" r="2" /><circle cx="15" cy="6" r="2" />
								<circle cx="9" cy="12" r="2" /><circle cx="15" cy="12" r="2" />
								<circle cx="9" cy="18" r="2" /><circle cx="15" cy="18" r="2" />
							</svg>
						</div>
						<span class="clip-index">{i + 1}</span>
						<div class="clip-row-info">
							<span class="clip-row-label">{clip.label}</span>
							<span class="clip-row-meta">
								{clip.videoName} - {formatTime(clip.endTime - clip.startTime)}
								{#if clip.lead && clip.follow}
									<span class="clip-row-dancers">{clip.lead} & {clip.follow}</span>
								{/if}
							</span>
						</div>
						<div class="clip-row-actions">
							{#if playerVisible}
								<button class="row-btn" onclick={() => skipToClip(i)} title="Jump to this clip">
									<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
								</button>
							{/if}
							<button class="row-btn danger" onclick={() => removeClipFromSession(i)} disabled title="Deletion disabled in UI — edit metadata.json manually">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.page {
		max-width: 720px;
		margin: 0 auto;
	}

	.not-found {
		text-align: center;
		padding: 60px 24px;
		color: #52525b;
	}

	.not-found a {
		color: #818cf8;
		text-decoration: none;
	}

	.top-bar {
		margin-bottom: 16px;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: #52525b;
		text-decoration: none;
		font-size: 13px;
		font-weight: 500;
		transition: color 0.15s;
	}

	.back-link:hover {
		color: #a1a1aa;
	}

	.header {
		margin-bottom: 20px;
	}

	h1 {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin: 0 0 4px;
	}

	.editable-name {
		cursor: pointer;
		transition: color 0.15s;
	}

	.editable-name:hover {
		color: #818cf8;
	}

	.name-form {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-bottom: 4px;
	}

	.name-input {
		flex: 1;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(99, 102, 241, 0.4);
		color: #e4e4e7;
		padding: 8px 12px;
		border-radius: 6px;
		font-size: 18px;
		font-weight: 700;
		font-family: 'Inter', sans-serif;
	}

	.name-input:focus {
		outline: none;
		border-color: #6366f1;
	}

	.save-btn, .cancel-btn {
		background: none;
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #a1a1aa;
		padding: 8px 14px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
	}

	.save-btn {
		background: rgba(99, 102, 241, 0.1);
		color: #818cf8;
		border-color: rgba(99, 102, 241, 0.2);
	}

	.header-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		color: #52525b;
		font-size: 13px;
		font-weight: 500;
	}

	.dot {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: #3f3f46;
	}

	.controls {
		display: flex;
		gap: 8px;
		margin-bottom: 20px;
		flex-wrap: wrap;
	}

	.play-all-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		background: #6366f1;
		color: #fff;
		border: none;
		padding: 9px 18px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: background 0.15s;
	}

	.play-all-btn:hover:not(:disabled) {
		background: #7c3aed;
	}

	.play-all-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.control-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		background: rgba(255, 255, 255, 0.04);
		color: #a1a1aa;
		border: 1px solid rgba(255, 255, 255, 0.06);
		padding: 8px 14px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.control-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
	}

	.control-btn.active {
		color: #818cf8;
		border-color: rgba(99, 102, 241, 0.3);
		background: rgba(99, 102, 241, 0.08);
	}

	/* Player */
	.player-section {
		background: #111113;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 10px;
		overflow: hidden;
		margin-bottom: 20px;
	}

	.player-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.04);
	}

	.now-playing {
		font-size: 12px;
		color: #71717a;
		font-weight: 500;
	}

	.now-playing strong {
		color: #e4e4e7;
	}

	.close-player {
		background: none;
		border: none;
		color: #52525b;
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		transition: color 0.15s;
	}

	.close-player:hover {
		color: #e4e4e7;
	}

	.player-wrapper {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		background: #000;
		cursor: pointer;
	}

	.player-wrapper video {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	:global(.player-wrapper:fullscreen),
	.fake-fullscreen {
		aspect-ratio: auto;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	:global(.player-wrapper:fullscreen video),
	.fake-fullscreen video {
		max-height: 100vh;
		max-width: 100vw;
		width: auto;
		height: auto;
	}
	.fake-fullscreen {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: #000;
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

	/* Player controls */
	.player-controls {
		padding: 0 14px 12px;
	}

	.progress-bar {
		height: 6px;
		background: rgba(255, 255, 255, 0.08);
		border-radius: 3px;
		cursor: pointer;
		margin-bottom: 10px;
		overflow: hidden;
	}

	.progress-bar:hover {
		height: 8px;
	}

	.progress-fill {
		height: 100%;
		background: #6366f1;
		border-radius: 3px;
		transition: width 0.1s linear;
	}

	.controls-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.controls-left {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.controls-right {
		display: flex;
		align-items: center;
	}

	.ctrl-btn {
		background: none;
		border: none;
		color: #a1a1aa;
		padding: 6px 8px;
		border-radius: 6px;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
		display: flex;
		align-items: center;
	}

	.ctrl-btn:hover {
		color: #e4e4e7;
		background: rgba(255, 255, 255, 0.06);
	}

	.speed-select {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #a1a1aa;
		padding: 4px 8px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 600;
		font-family: 'Inter', sans-serif;
		cursor: pointer;
		-webkit-appearance: none;
		appearance: none;
	}

	.speed-select:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
	}

	/* Picker */
	.picker {
		background: #111113;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 10px;
		margin-bottom: 20px;
		overflow: hidden;
	}

	.picker-header {
		display: flex;
		gap: 8px;
		padding: 10px 12px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.04);
	}

	.picker-search {
		flex: 1;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #e4e4e7;
		padding: 7px 10px;
		border-radius: 6px;
		font-size: 13px;
		font-family: 'Inter', sans-serif;
	}

	.picker-search:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
	}

	.picker-search::placeholder {
		color: #3f3f46;
	}

	.picker-type-filter {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #e4e4e7;
		padding: 7px 10px;
		border-radius: 6px;
		font-size: 13px;
		font-family: 'Inter', sans-serif;
		cursor: pointer;
		-webkit-appearance: none;
		appearance: none;
		min-width: 110px;
	}

	.picker-type-filter:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
	}

	.picker-close {
		background: none;
		border: none;
		color: #52525b;
		cursor: pointer;
		padding: 6px;
	}

	.picker-list {
		max-height: 320px;
		overflow-y: auto;
	}

	.picker-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 10px 14px;
		background: none;
		border: none;
		border-bottom: 1px solid rgba(255, 255, 255, 0.02);
		color: inherit;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		text-align: left;
		transition: background 0.15s;
	}

	.picker-item:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.picker-item svg {
		color: #52525b;
		flex-shrink: 0;
	}

	.picker-item:hover svg {
		color: #818cf8;
	}

	.picker-item-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.picker-item-label {
		font-size: 13px;
		font-weight: 500;
		color: #e4e4e7;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.picker-item-meta {
		font-size: 11px;
		color: #52525b;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.picker-badge {
		background: rgba(251, 191, 36, 0.12);
		color: #fbbf24;
		padding: 1px 5px;
		border-radius: 3px;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
	}

	.picker-empty {
		text-align: center;
		color: #3f3f46;
		font-size: 13px;
		padding: 24px;
		margin: 0;
	}

	/* Clip list */
	.empty-list {
		text-align: center;
		padding: 40px 24px;
		color: #3f3f46;
		font-size: 14px;
	}

	.empty-list p {
		margin: 0;
	}

	.clip-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.clip-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 8px;
		transition: border-color 0.15s, background 0.15s, opacity 0.15s;
		cursor: grab;
		user-select: none;
		-webkit-user-select: none;
	}

	.clip-row:active {
		cursor: grabbing;
	}

	.clip-row.dragging {
		opacity: 0.4;
	}

	.clip-row.drag-over {
		border-color: #6366f1;
		background: rgba(99, 102, 241, 0.05);
	}

	.clip-row.playing-now {
		border-color: rgba(99, 102, 241, 0.3);
		background: rgba(99, 102, 241, 0.06);
	}

	.drag-handle {
		color: #3f3f46;
		flex-shrink: 0;
		cursor: grab;
		padding: 4px 2px;
	}

	.clip-row:hover .drag-handle {
		color: #71717a;
	}

	.clip-index {
		font-size: 12px;
		font-weight: 600;
		color: #3f3f46;
		min-width: 18px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.clip-row.playing-now .clip-index {
		color: #818cf8;
	}

	.clip-row-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.clip-row-label {
		font-size: 13px;
		font-weight: 500;
		color: #e4e4e7;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.clip-row-meta {
		font-size: 11px;
		color: #52525b;
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.clip-row-dancers {
		color: #71717a;
	}

	.clip-row-actions {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
	}

	.row-btn {
		background: none;
		border: none;
		color: #3f3f46;
		padding: 6px;
		border-radius: 4px;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}

	.row-btn:hover {
		color: #a1a1aa;
		background: rgba(255, 255, 255, 0.04);
	}

	.row-btn.danger:hover {
		color: #ef4444;
		background: rgba(239, 68, 68, 0.08);
	}
</style>
