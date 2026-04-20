<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import * as store from '$lib/store.svelte';
	import type { ClipMeta } from '$lib/store.svelte';
	import VideoPlayer from '$lib/components/VideoPlayer.svelte';
	import ClipMarker from '$lib/components/ClipMarker.svelte';
	import ClipCard from '$lib/components/ClipCard.svelte';
	import Dropdown from '$lib/components/Dropdown.svelte';

	let videoId = $derived($page.params.id ?? '');
	let videoMeta = $derived(store.getVideos().find(v => v.id === videoId));
	let clips = $derived(store.getClipsByVideo(videoId));

	let editLead = $state('');
	let editFollow = $state('');
	let editDance = $state('');
	let editCategory = $state<string>('demo');
	let metaInitialized = $state(false);

	const couples: [string, string][] = [
		['Anthony', 'Katie'],
		['Cornel', 'Rithika'],
		['Daniel', 'Desiree'],
		['Emilien', 'Tehina'],
		['Gero', 'Migle'],
		['Irakli', 'Maria'],
		['Jes', 'Jenny'],
		['Luis', 'Andrea'],
		['Marcus', 'Bianca'],
		['Melvin', 'Gatica'],
		['Micka', 'Laura'],
		['Miguel', 'Sunsire'],
		['Ofir', 'Ofri'],
		['Victor', 'Monika'],
	];
	const extraLeads = ['Favian'];
	const leadOptions = [...new Set([...couples.map(c => c[0]), ...extraLeads])].sort().map(n => ({ value: n, label: n }));
	const followOptions = [...new Set(couples.map(c => c[1]))].sort().map(n => ({ value: n, label: n }));
	const danceOptions = [{ value: 'bachata', label: 'Bachata' }, { value: 'salsa', label: 'Salsa' }];

	// Populate edit fields from video meta
	$effect(() => {
		if (videoMeta && !metaInitialized) {
			editLead = videoMeta.lead || '';
			editFollow = videoMeta.follow || '';
			editDance = videoMeta.dance || '';
			editCategory = videoMeta.category ?? 'demo';
			metaInitialized = true;
		}
	});

	// Auto-save on change
	$effect(() => {
		if (metaInitialized && videoMeta) {
			const lead = editLead;
			const follow = editFollow;
			const dance = editDance;
			const category = editCategory as 'demo' | 'jack-and-jill' | 'workshop' | 'social';
			if (lead !== videoMeta.lead || follow !== videoMeta.follow || dance !== videoMeta.dance || category !== (videoMeta.category ?? 'demo')) {
				store.updateVideo(videoId, { lead, follow, dance, category });
			}
		}
	});

	function selectCouple(l: string, f: string) {
		editLead = l;
		editFollow = f;
	}

	let videoSrc = $state<string | null>(null);
	let videoSource = $state<'local' | 'cdn' | null>(null);
	let videoLoadError = $state('');
	let currentTime = $state(0);
	let duration = $state(0);
	let inPoint = $state<number | null>(null);
	let outPoint = $state<number | null>(null);
	let revokeUrl: (() => void) | null = null;
	let loadingVideoId = '';

	let effectiveCdnUrl = $derived(store.getCdnUrlForVideo(videoId));
	let editCdnUrl = $state('');
	let cdnUrlInitialized = $state(false);

	$effect(() => {
		if (videoMeta && !cdnUrlInitialized) {
			editCdnUrl = videoMeta.cdnUrl ?? '';
			cdnUrlInitialized = true;
		}
	});

	async function saveCdnUrl() {
		await store.updateVideo(videoId, { cdnUrl: editCdnUrl.trim() });
		// Reload video with new URL
		loadingVideoId = '';
	}

	let creatingPractice = $state(false);
	async function createPracticeFromClips() {
		if (!videoMeta || clips.length === 0 || creatingPractice) return;
		creatingPractice = true;
		const ordered = [...clips].sort((a, b) => a.startTime - b.startTime).map(c => c.id);
		const practice = await store.addPractice({ name: videoMeta.name, clipIds: ordered });
		goto(`/practice/${practice.id}`);
	}

	$effect(() => {
		const id = videoId;
		const s = store.getState();
		if (s !== 'ready') return;

		if (!videoMeta) {
			goto('/');
			return;
		}

		if (videoMeta.duration > 0) {
			duration = videoMeta.duration;
		}

		if (loadingVideoId === id) return;
		loadingVideoId = id;

		store.getVideoUrl(id).then(({ url, revoke, source }) => {
			if (revokeUrl) revokeUrl();
			videoSrc = url;
			videoSource = source;
			revokeUrl = revoke;
		}).catch((err) => {
			videoLoadError = String(err);
		});

		return () => {
			if (revokeUrl) revokeUrl();
		};
	});
</script>

{#if videoMeta && videoSrc}
	<div class="editor">
		<div class="editor-main">
			<div class="editor-header">
				<a href="/" class="back">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="15 18 9 12 15 6" />
					</svg>
					Back
				</a>
				<h2>{videoMeta.name}</h2>
			</div>

			<div class="video-meta">
				<div class="meta-presets">
					{#each couples as [l, f]}
						<button
							type="button"
							class="meta-preset"
							class:active={editLead === l && editFollow === f}
							onclick={() => selectCouple(l, f)}
						>{l} & {f}</button>
					{/each}
				</div>
				<div class="meta-fields">
					<Dropdown label="Lead" bind:value={editLead} options={leadOptions} placeholder="Select lead..." />
					<Dropdown label="Follow" bind:value={editFollow} options={followOptions} placeholder="Select follow..." />
					<Dropdown label="Dance" bind:value={editDance} options={danceOptions} placeholder="Select dance..." />
					<Dropdown label="Category" bind:value={editCategory} options={[{ value: 'demo', label: 'Demo' }, { value: 'jack-and-jill', label: 'Jack & Jill' }, { value: 'workshop', label: 'Workshop' }, { value: 'social', label: 'Social' }]} />
				</div>
				<div class="visibility-options">
					<button class="vis-toggle" class:active={videoMeta.hidden} onclick={() => store.updateVideo(videoId, { hidden: !videoMeta.hidden })}>Hide from home</button>
					<button class="vis-toggle" class:active={videoMeta.hiddenFromSearch} onclick={() => store.updateVideo(videoId, { hiddenFromSearch: !videoMeta.hiddenFromSearch })}>Hide from search</button>
				</div>
				<div class="cdn-section">
					<div class="cdn-status">
						{#if videoSource === 'local'}
							<span class="cdn-badge local">Local file</span>
						{:else if videoSource === 'cdn'}
							<span class="cdn-badge cdn">Streaming CDN</span>
						{:else if effectiveCdnUrl}
							<span class="cdn-badge cdn">CDN ready</span>
						{:else}
							<span class="cdn-badge none">No CDN</span>
						{/if}
					</div>
					<div class="cdn-url-row">
						<input
							type="text"
							class="cdn-url-input"
							placeholder={effectiveCdnUrl ?? 'Paste Bunny CDN URL override...'}
							bind:value={editCdnUrl}
							onkeydown={(e) => { if (e.key === 'Enter') saveCdnUrl(); }}
						/>
						{#if editCdnUrl !== (videoMeta.cdnUrl ?? '')}
							<button class="cdn-url-save" onclick={saveCdnUrl}>Save</button>
						{/if}
					</div>
					{#if effectiveCdnUrl && !videoMeta.cdnUrl}
						<p class="cdn-auto-hint">Auto URL: <code>{effectiveCdnUrl}</code></p>
					{/if}
				</div>
			</div>

			<VideoPlayer
				src={videoSrc}
				bind:currentTime
				bind:duration
				{clips}
				onSetIn={(t) => inPoint = t}
				onSetOut={(t) => outPoint = t}
			/>

			<div class="marker-section">
				<ClipMarker
					{videoId}
					videoName={videoMeta.name}
					videoLead={editLead}
					videoFollow={editFollow}
					videoDance={editDance}
					bind:inPoint
					bind:outPoint
				/>
			</div>
		</div>

		{#if clips.length > 0}
			<div class="clips-sidebar">
				<div class="sidebar-header">
					<h3>Clips</h3>
					<span class="clip-count">{clips.length}</span>
					<button
						class="practice-btn"
						onclick={createPracticeFromClips}
						disabled={creatingPractice}
						title="Create a practice session with all clips from this video"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polygon points="5 3 19 12 5 21 5 3" />
						</svg>
						{creatingPractice ? 'Creating…' : 'Create practice'}
					</button>
				</div>
				<div class="clips-list">
					{#each clips.filter(c => !c.parentClipId) as clip (clip.id)}
						<ClipCard {clip} />
						{#each clips.filter(c => c.parentClipId === clip.id) as subClip (subClip.id)}
							<div class="sub-clip-indent">
								<ClipCard clip={subClip} />
							</div>
						{/each}
					{/each}
					{#each clips.filter(c => c.parentClipId && !clips.some(p => p.id === c.parentClipId)) as orphan (orphan.id)}
						<ClipCard clip={orphan} />
					{/each}
				</div>
			</div>
		{/if}
	</div>
{:else}
	<div class="loading">
		{#if videoLoadError}
			<p style="color: #ef4444; font-size: 13px; text-align: center;">
				Failed to load video: {videoLoadError}
			</p>
		{:else}
			<div class="loading-spinner"></div>
		{/if}
		{#if videoMeta}
			<p style="color: #52525b; font-size: 11px; text-align: center; margin-top: 12px;">
				{videoMeta.name} | duration: {videoMeta.duration}s | id: {videoMeta.id}
			</p>
		{/if}
	</div>
{/if}

<style>
	.editor {
		display: grid;
		grid-template-columns: 1fr;
		gap: 24px;
	}

	@media (min-width: 960px) {
		.editor {
			grid-template-columns: 1fr 340px;
		}
	}

	.editor-header {
		margin-bottom: 16px;
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

	h2 {
		margin: 8px 0 0;
		font-size: 18px;
		font-weight: 600;
		letter-spacing: -0.02em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.video-meta {
		background: #18181b;
		border-radius: 10px;
		padding: 14px;
		border: 1px solid rgba(255, 255, 255, 0.04);
		margin-bottom: 16px;
	}

	.meta-presets {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin-bottom: 10px;
	}

	.meta-preset {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #71717a;
		padding: 4px 9px;
		border-radius: 12px;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.meta-preset:hover {
		background: rgba(255, 255, 255, 0.06);
		color: #a1a1aa;
	}

	.meta-preset.active {
		background: rgba(99, 102, 241, 0.12);
		color: #818cf8;
		border-color: rgba(99, 102, 241, 0.25);
	}

	.meta-fields {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 8px;
	}

	@media (max-width: 640px) {
		.meta-fields {
			grid-template-columns: 1fr;
		}
	}

	.visibility-options {
		display: flex;
		gap: 6px;
		margin-top: 10px;
	}

	.vis-toggle {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #52525b;
		padding: 5px 10px;
		border-radius: 8px;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.vis-toggle:hover {
		background: rgba(255, 255, 255, 0.06);
		color: #71717a;
	}

	.vis-toggle.active {
		background: rgba(239, 68, 68, 0.1);
		color: #f87171;
		border-color: rgba(239, 68, 68, 0.25);
	}

	.marker-section {
		margin-top: 16px;
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 14px;
	}

	.sidebar-header h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		color: #e4e4e7;
		letter-spacing: -0.01em;
	}

	.clip-count {
		background: rgba(255, 255, 255, 0.06);
		color: #71717a;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: 10px;
	}

	.practice-btn {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		background: rgba(255, 255, 255, 0.06);
		color: #e4e4e7;
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}

	.practice-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.1);
		border-color: rgba(255, 255, 255, 0.14);
	}

	.practice-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.clips-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.sub-clip-indent {
		margin-left: 16px;
		border-left: 2px solid rgba(99, 102, 241, 0.2);
		padding-left: 10px;
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

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.cdn-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 10px;
		border-top: 1px solid rgba(255, 255, 255, 0.04);
	}

	.cdn-status {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.cdn-badge {
		font-size: 11px;
		font-weight: 500;
		padding: 3px 8px;
		border-radius: 10px;
	}

	.cdn-badge.local {
		background: rgba(99, 102, 241, 0.1);
		color: #818cf8;
		border: 1px solid rgba(99, 102, 241, 0.2);
	}

	.cdn-badge.cdn {
		background: rgba(52, 211, 153, 0.1);
		color: #34d399;
		border: 1px solid rgba(52, 211, 153, 0.2);
	}

	.cdn-badge.none {
		background: rgba(255, 255, 255, 0.03);
		color: #52525b;
		border: 1px solid rgba(255, 255, 255, 0.06);
	}

	.cdn-url-row {
		display: flex;
		gap: 6px;
	}

	.cdn-url-input {
		flex: 1;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #a1a1aa;
		padding: 6px 10px;
		border-radius: 6px;
		font-size: 11px;
		font-family: 'SF Mono', monospace;
		outline: none;
	}

	.cdn-url-input:focus {
		border-color: rgba(52, 211, 153, 0.3);
		color: #e4e4e7;
	}

	.cdn-url-save {
		background: rgba(52, 211, 153, 0.1);
		color: #34d399;
		border: 1px solid rgba(52, 211, 153, 0.2);
		padding: 6px 12px;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		white-space: nowrap;
	}

	.cdn-auto-hint {
		font-size: 10px;
		color: #3f3f46;
		margin: 0;
	}

	.cdn-auto-hint code {
		color: #52525b;
		font-family: 'SF Mono', monospace;
	}
</style>
