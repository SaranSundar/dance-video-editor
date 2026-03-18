<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import * as store from '$lib/store.svelte';
	import type { ClipMeta } from '$lib/store.svelte';
	import VideoPlayer from '$lib/components/VideoPlayer.svelte';
	import ClipMarker from '$lib/components/ClipMarker.svelte';
	import ClipCard from '$lib/components/ClipCard.svelte';

	let videoId = $derived($page.params.id);
	let videoMeta = $derived(store.getVideos().find(v => v.id === videoId));
	let clips = $derived(store.getClipsByVideo(videoId));

	let videoBlob = $state<Blob | null>(null);
	let videoSrc = $state<string | null>(null);
	let currentTime = $state(0);
	let duration = $state(0);
	let inPoint = $state<number | null>(null);
	let outPoint = $state<number | null>(null);

	$effect(() => {
		const id = videoId;
		const state = store.getState();

		// Don't redirect while store is still loading
		if (state !== 'ready') return;

		if (!videoMeta) {
			goto('/');
			return;
		}

		store.getVideoBlob(id).then((blob) => {
			videoBlob = blob;
			videoSrc = URL.createObjectURL(blob);
		});

		return () => {
			if (videoSrc) URL.revokeObjectURL(videoSrc);
		};
	});
</script>

{#if videoMeta && videoSrc && videoBlob}
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
					videoLead={videoMeta.lead || ''}
					videoFollow={videoMeta.follow || ''}
					videoDance={videoMeta.dance || ''}
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
				</div>
				<div class="clips-list">
					{#each clips as clip (clip.id)}
						<ClipCard {clip} />
					{/each}
				</div>
			</div>
		{/if}
	</div>
{:else}
	<div class="loading">
		<div class="loading-spinner"></div>
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

	.clips-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
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
</style>
