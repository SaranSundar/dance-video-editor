<script lang="ts">
	import * as store from '$lib/store.svelte';
	import ClipCard from '$lib/components/ClipCard.svelte';

	function lazySrc(node: HTMLVideoElement | HTMLImageElement, src: string) {
		let disconnected = false;
		const observer = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting && !disconnected) {
				node.src = src;
				observer.disconnect();
			}
		}, { rootMargin: '300px' });
		observer.observe(node);
		return {
			destroy() {
				disconnected = true;
				observer.disconnect();
			}
		};
	}

	let videos = $derived(store.getVideos());
	let allClips = $derived(store.getClips());

	let searchQuery = $state('');

	let jnjVideoIds = $derived(() => {
		const set = new Set<string>();
		for (const v of videos) {
			if (v.category === 'jack-and-jill') set.add(v.id);
		}
		return set;
	});

	let jnjVideos = $derived(() => {
		const ids = jnjVideoIds();
		let result = videos.filter(v => ids.has(v.id));
		const q = searchQuery.trim().toLowerCase();
		if (q) {
			result = result.filter(v =>
				v.name.toLowerCase().includes(q) ||
				(v.lead || '').toLowerCase().includes(q) ||
				(v.follow || '').toLowerCase().includes(q)
			);
			result = result.filter(v => !v.hiddenFromSearch);
		} else {
			result = result.filter(v => !v.hidden);
		}
		return result.sort((a, b) => ((b.addedAt || '') > (a.addedAt || '') ? 1 : -1));
	});

	let jnjClips = $derived(() => {
		const ids = jnjVideoIds();
		const q = searchQuery.trim().toLowerCase();
		const hasSearch = q.length > 0;
		let result = allClips.filter(c => ids.has(c.videoId));
		if (hasSearch) {
			result = result.filter(c => !c.hiddenFromSearch);
			result = result.filter(c =>
				c.label.toLowerCase().includes(q) ||
				c.videoName.toLowerCase().includes(q) ||
				(c.lead || '').toLowerCase().includes(q) ||
				(c.follow || '').toLowerCase().includes(q) ||
				c.tags.some(t => t.toLowerCase().includes(q))
			);
		} else {
			result = result.filter(c => !c.hidden && !c.parentClipId);
		}
		return result.sort((a, b) => ((b.createdAt || '') > (a.createdAt || '') ? 1 : -1));
	});

	let thumbnailUrls = $state<Record<string, string>>({});
	let thumbsLoading = $state(false);
	$effect(() => {
		const vids = jnjVideos();
		if (thumbsLoading || vids.length === 0) return;
		const missing = vids.filter(v => !thumbnailUrls[v.id]);
		if (missing.length === 0) return;
		thumbsLoading = true;
		Promise.allSettled(
			missing.map(async (video) => {
				const url = await store.getVideoThumbnail(video.id);
				return url ? { id: video.id, url } : null;
			})
		).then(results => {
			const updates: Record<string, string> = {};
			for (const r of results) {
				if (r.status === 'fulfilled' && r.value) {
					updates[r.value.id] = r.value.url;
				}
			}
			if (Object.keys(updates).length > 0) {
				thumbnailUrls = { ...thumbnailUrls, ...updates };
			}
			thumbsLoading = false;
		});
	});

	function formatDuration(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}
</script>

<div class="page">
	<div class="page-header">
		<h1>Jack &amp; Jill</h1>
		<p>Clips and videos from J&amp;J competitions.</p>
	</div>

	{#if videos.length > 0 || allClips.length > 0}
		<div class="filters">
			<input
				type="text"
				class="search-input"
				placeholder="Search J&J clips and videos..."
				bind:value={searchQuery}
			/>
		</div>
	{/if}

	<div class="header">
		<h2>Clips</h2>
		<span class="count">{jnjClips().length} clip{jnjClips().length === 1 ? '' : 's'}</span>
	</div>

	{#if jnjClips().length > 0}
		<div class="clip-grid">
			{#each jnjClips() as clip (clip.id)}
				<ClipCard {clip} />
			{/each}
		</div>
	{:else}
		<p class="no-results">No J&amp;J clips yet. Mark a video's category as "Jack &amp; Jill" to see its clips here.</p>
	{/if}

	<div class="section-divider"></div>

	<div class="header">
		<h2>Videos</h2>
		<span class="count">{jnjVideos().length} video{jnjVideos().length === 1 ? '' : 's'}</span>
	</div>

	{#if jnjVideos().length > 0}
		<div class="video-grid">
			{#each jnjVideos() as video (video.id)}
				<a href="/videos/{video.id}" class="video-card">
					<div class="video-thumb">
						{#if thumbnailUrls[video.id]}
							<img src={thumbnailUrls[video.id]} alt={video.name} />
						{:else if store.getCdnUrlForVideo(video.id)}
							<!-- svelte-ignore a11y_media_has_caption -->
							<video
								use:lazySrc={`${store.getCdnUrlForVideo(video.id)}#t=1`}
								muted
								preload="metadata"
								playsinline
								class="video-thumb-vid"
							></video>
						{/if}
						<div class="play-overlay">
							<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
								<polygon points="5 3 19 12 5 21 5 3" />
							</svg>
						</div>
						<span class="vid-duration">{formatDuration(video.duration)}</span>
					</div>
					<div class="video-info">
						<h3>{video.name}</h3>
					</div>
				</a>
			{/each}
		</div>
	{:else}
		<p class="no-results">No J&amp;J videos yet. Edit a video and set its category to "Jack &amp; Jill".</p>
	{/if}
</div>

<style>
	.page {
		max-width: 960px;
		margin: 0 auto;
	}

	.page-header {
		margin-bottom: 24px;
	}

	.page-header h1 {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin: 0 0 6px;
		color: #e4e4e7;
	}

	.page-header p {
		margin: 0;
		color: #71717a;
		font-size: 13px;
	}

	.filters {
		margin-bottom: 24px;
	}

	.search-input {
		width: 100%;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #e4e4e7;
		padding: 10px 14px;
		border-radius: 8px;
		font-size: 13px;
		font-family: 'Inter', sans-serif;
		transition: border-color 0.15s;
		box-sizing: border-box;
	}

	.search-input::placeholder {
		color: #3f3f46;
	}

	.search-input:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
	}

	.header {
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 16px;
	}

	.header h2 {
		font-size: 16px;
		font-weight: 600;
		color: #e4e4e7;
		margin: 0;
		letter-spacing: -0.01em;
	}

	.count {
		font-size: 12px;
		color: #52525b;
		font-weight: 500;
	}

	.clip-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 16px;
		margin-bottom: 24px;
	}

	.no-results {
		color: #52525b;
		font-size: 13px;
		padding: 24px 0;
		margin: 0;
	}

	.section-divider {
		height: 1px;
		background: rgba(255, 255, 255, 0.06);
		margin: 32px 0 24px;
	}

	.video-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 16px;
	}

	.video-card {
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 10px;
		overflow: hidden;
		text-decoration: none;
		color: inherit;
		display: block;
		transition: transform 0.15s, border-color 0.15s;
	}

	.video-card:hover {
		border-color: rgba(255, 255, 255, 0.1);
		transform: translateY(-2px);
	}

	.video-thumb {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		background: #09090b;
		overflow: hidden;
	}

	.video-thumb img,
	.video-thumb-vid {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transition: transform 0.2s;
	}

	.play-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: rgba(255, 255, 255, 0.85);
		opacity: 0;
		transition: opacity 0.15s;
		background: rgba(0, 0, 0, 0.2);
		pointer-events: none;
	}

	.video-card:hover .play-overlay {
		opacity: 1;
	}

	.vid-duration {
		position: absolute;
		right: 8px;
		bottom: 8px;
		background: rgba(0, 0, 0, 0.72);
		color: #e4e4e7;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: 4px;
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	.video-info {
		padding: 10px 12px 12px;
	}

	.video-info h3 {
		font-size: 13px;
		font-weight: 500;
		color: #e4e4e7;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
