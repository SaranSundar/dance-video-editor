<script lang="ts">
	import * as store from '$lib/store.svelte';
	import ClipCard from '$lib/components/ClipCard.svelte';
	import Dropdown from '$lib/components/Dropdown.svelte';

	let videos = $derived(store.getVideos());
	let clips = $derived(store.getClips());
	let dragOver = $state(false);
	let importing = $state(false);
	let editingId = $state<string | null>(null);

	// YouTube helper
	let youtubeUrl = $state('');
	let ytdlpCommand = $state('');
	let copied = $state(false);
	let editName = $state('');
	let editExt = $state('');
	let thumbnailUrls = $state<Record<string, string>>({});

	// Import form state
	let pendingImports = $state<{ file: File; lead: string; follow: string; dance: string }[]>([]);

	const couples: [string, string][] = [
		['Cornel', 'Rithika'],
		['Emilien', 'Tehina'],
		['Gero', 'Migle'],
		['Irakli', 'Maria'],
		['Luis', 'Andrea'],
		['Marcus', 'Bianca'],
	];
	const extraLeads = ['Favian'];
	const leadOptions = [...new Set([...couples.map(c => c[0]), ...extraLeads])].sort().map(n => ({ value: n, label: n }));
	const followOptions = [...new Set(couples.map(c => c[1]))].sort().map(n => ({ value: n, label: n }));
	const danceOptions = [{ value: 'bachata', label: 'Bachata' }, { value: 'salsa', label: 'Salsa' }];

	$effect(() => {
		for (const video of videos) {
			if (!thumbnailUrls[video.id]) {
				store.getVideoThumbnail(video.id).then((blob) => {
					if (blob) {
						thumbnailUrls[video.id] = URL.createObjectURL(blob);
						thumbnailUrls = { ...thumbnailUrls };
					}
				});
			}
		}
	});

	function stageFiles(files: FileList | null) {
		if (!files) return;
		const videoFiles = Array.from(files).filter(f => f.type.startsWith('video/'));
		if (videoFiles.length === 0) return;
		pendingImports = videoFiles.map(file => ({ file, lead: 'Irakli', follow: 'Maria', dance: 'bachata' }));
	}

	function applyCouple(l: string, f: string) {
		pendingImports = pendingImports.map(entry => ({ ...entry, lead: l, follow: f }));
	}

	async function confirmImport() {
		importing = true;
		for (const entry of pendingImports) {
			const { duration, thumbnail } = await getVideoInfo(entry.file);
			await store.addVideo(entry.file, duration, thumbnail, { lead: entry.lead, follow: entry.follow, dance: entry.dance });
		}
		pendingImports = [];
		importing = false;
	}

	function cancelImport() {
		pendingImports = [];
	}

	function getVideoInfo(file: File): Promise<{ duration: number; thumbnail: Blob | null }> {
		return new Promise((resolve) => {
			const video = document.createElement('video');
			video.preload = 'metadata';
			video.muted = true;

			video.onloadedmetadata = () => {
				// Seek to 1 second or 10% of duration for a good thumbnail
				video.currentTime = Math.min(1, video.duration * 0.1);
			};

			video.onseeked = () => {
				try {
					const canvas = document.createElement('canvas');
					canvas.width = video.videoWidth;
					canvas.height = video.videoHeight;
					const ctx = canvas.getContext('2d');
					if (ctx) {
						ctx.drawImage(video, 0, 0);
						canvas.toBlob(
							(blob) => {
								URL.revokeObjectURL(video.src);
								resolve({ duration: video.duration, thumbnail: blob });
							},
							'image/jpeg',
							0.8
						);
					} else {
						URL.revokeObjectURL(video.src);
						resolve({ duration: video.duration, thumbnail: null });
					}
				} catch {
					URL.revokeObjectURL(video.src);
					resolve({ duration: video.duration, thumbnail: null });
				}
			};

			video.onerror = () => {
				URL.revokeObjectURL(video.src);
				resolve({ duration: 0, thumbnail: null });
			};

			video.src = URL.createObjectURL(file);
		});
	}

	function generateYtdlp() {
		if (!youtubeUrl.trim()) return;
		ytdlpCommand = `yt-dlp --no-playlist -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 "${youtubeUrl.trim()}"`;
	}

	async function copyCommand() {
		await navigator.clipboard.writeText(ytdlpCommand);
		copied = true;
		setTimeout(() => { copied = false; }, 2000);
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		stageFiles(e.dataTransfer?.files ?? null);
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}

	function formatDuration(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function startRename(e: Event, video: { id: string; name: string }) {
		e.preventDefault();
		e.stopPropagation();
		editingId = video.id;
		const dotIndex = video.name.lastIndexOf('.');
		if (dotIndex > 0) {
			editName = video.name.slice(0, dotIndex);
			editExt = video.name.slice(dotIndex);
		} else {
			editName = video.name;
			editExt = '';
		}
	}

	async function saveRename(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		if (editingId && editName.trim()) {
			await store.renameVideo(editingId, editName.trim() + editExt);
		}
		editingId = null;
	}

	function cancelRename(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		editingId = null;
	}

	function handleRenameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') saveRename(e);
		if (e.key === 'Escape') cancelRename(e);
	}

	async function deleteVideo(e: Event, id: string) {
		e.preventDefault();
		e.stopPropagation();
		if (confirm('Delete this video and all its clips?')) {
			await store.deleteVideo(id);
		}
	}
</script>

<div class="page">
	{#if clips.length > 0}
		<div class="header">
			<h1>Clips</h1>
			<span class="count">{clips.length} clip{clips.length === 1 ? '' : 's'}</span>
		</div>
		<div class="clip-grid">
			{#each clips as clip (clip.id)}
				<ClipCard {clip} />
			{/each}
		</div>
		<div class="section-divider"></div>
	{/if}

	<div class="header">
		<h1>Videos</h1>
		{#if videos.length > 0}
			<span class="count">{videos.length} video{videos.length === 1 ? '' : 's'}</span>
		{/if}
	</div>

	{#if pendingImports.length > 0}
		<div class="import-form">
			<h3>Import {pendingImports.length} video{pendingImports.length > 1 ? 's' : ''}</h3>

			<div class="couple-presets">
				{#each couples as [l, f]}
					<button
						type="button"
						class="preset-btn"
						class:active={pendingImports.every(e => e.lead === l && e.follow === f)}
						onclick={() => applyCouple(l, f)}
					>{l} & {f}</button>
				{/each}
			</div>

			<div class="import-list">
				{#each pendingImports as entry, i}
					<div class="import-item">
						<span class="import-filename">{entry.file.name}</span>
						<div class="import-item-fields">
							<Dropdown label="Lead" bind:value={pendingImports[i].lead} options={leadOptions} placeholder="Select lead..." />
							<Dropdown label="Follow" bind:value={pendingImports[i].follow} options={followOptions} placeholder="Select follow..." />
							<Dropdown label="Dance" bind:value={pendingImports[i].dance} options={danceOptions} />
						</div>
					</div>
				{/each}
			</div>

			<div class="import-actions">
				<button class="import-btn" onclick={confirmImport} disabled={importing}>
					{importing ? 'Importing...' : 'Import'}
				</button>
				<button class="import-cancel" onclick={cancelImport} disabled={importing}>Cancel</button>
			</div>
		</div>
	{:else}
		<div class="youtube-section">
			<div class="youtube-input-row">
				<input
					type="text"
					class="youtube-input"
					placeholder="Paste YouTube URL to get download command..."
					bind:value={youtubeUrl}
					onkeydown={(e) => { if (e.key === 'Enter') generateYtdlp(); }}
					oninput={() => { ytdlpCommand = ''; }}
				/>
				<button
					class="youtube-btn"
					onclick={generateYtdlp}
					disabled={!youtubeUrl.trim()}
				>
					Get Command
				</button>
			</div>
			{#if ytdlpCommand}
				<div class="ytdlp-output">
					<code>{ytdlpCommand}</code>
					<button class="copy-btn" onclick={copyCommand}>
						{copied ? 'Copied!' : 'Copy'}
					</button>
				</div>
				<p class="ytdlp-hint">Run this in your terminal, then import the downloaded file below</p>
			{/if}
		</div>

		<div class="or-divider"><span>or</span></div>

		<div
			class="drop-zone"
			class:active={dragOver}
			role="button"
			tabindex="0"
			ondrop={handleDrop}
			ondragover={handleDragOver}
			ondragleave={() => dragOver = false}
		>
			<div class="drop-content">
				<div class="drop-icon">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
						<polyline points="17 8 12 3 7 8" />
						<line x1="12" y1="3" x2="12" y2="15" />
					</svg>
				</div>
				<p class="drop-title">Drop video files here</p>
				<p class="drop-sub">or click to browse from your device</p>
			</div>
			<input
				type="file"
				accept="video/*"
				multiple
				onchange={(e) => stageFiles((e.target as HTMLInputElement).files)}
			/>
		</div>
	{/if}

	{#if videos.length > 0}
		<div class="video-grid">
			{#each videos as video}
				<a href="/videos/{video.id}" class="video-card">
					<div class="video-thumb">
						{#if thumbnailUrls[video.id]}
							<img src={thumbnailUrls[video.id]} alt={video.name} />
						{/if}
						<div class="play-overlay">
							<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
								<polygon points="5 3 19 12 5 21 5 3" />
							</svg>
						</div>
						<span class="vid-duration">{formatDuration(video.duration)}</span>
					</div>
					<div class="video-info">
						{#if editingId === video.id}
							<div class="rename-row" onclick={(e) => e.preventDefault()}>
								<!-- svelte-ignore a11y_autofocus -->
								<input
									type="text"
									class="rename-input"
									bind:value={editName}
									onkeydown={handleRenameKeydown}
									onblur={saveRename}
									autofocus
								/>
								{#if editExt}<span class="rename-ext">{editExt}</span>{/if}
							</div>
						{:else}
							<h3>{video.name}</h3>
							<div class="video-actions">
								<button class="action-icon-btn" onclick={(e) => startRename(e, video)} title="Rename">Rename</button>
								<button class="action-icon-btn delete-btn" onclick={(e) => deleteVideo(e, video.id)} title="Delete">Delete</button>
							</div>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 960px;
		margin: 0 auto;
	}

	.header {
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 24px;
	}

	.youtube-section {
		margin-bottom: 0;
	}

	.youtube-input-row {
		display: flex;
		gap: 8px;
	}

	.youtube-input {
		flex: 1;
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
		padding: 12px 14px;
		border-radius: 10px;
		font-size: 13px;
		font-family: 'Inter', sans-serif;
		outline: none;
		transition: border-color 0.15s;
	}

	.youtube-input:focus {
		border-color: rgba(99, 102, 241, 0.5);
	}

	.youtube-input:disabled {
		opacity: 0.5;
	}

	.youtube-btn {
		background: #6366f1;
		color: #fff;
		border: none;
		padding: 12px 20px;
		border-radius: 10px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: background 0.15s;
		white-space: nowrap;
	}

	.youtube-btn:hover:not(:disabled) {
		background: #7c3aed;
	}

	.youtube-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.ytdlp-output {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		padding: 10px 12px;
	}

	.ytdlp-output code {
		flex: 1;
		font-size: 12px;
		color: #a1a1aa;
		font-family: 'SF Mono', 'Fira Code', monospace;
		word-break: break-all;
		line-height: 1.5;
	}

	.copy-btn {
		background: rgba(99, 102, 241, 0.1);
		color: #818cf8;
		border: 1px solid rgba(99, 102, 241, 0.2);
		padding: 5px 12px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		white-space: nowrap;
		transition: all 0.15s;
	}

	.copy-btn:hover {
		background: rgba(99, 102, 241, 0.18);
	}

	.ytdlp-hint {
		margin: 6px 0 0;
		font-size: 11px;
		color: #52525b;
	}

	.or-divider {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 16px 0;
		color: #3f3f46;
		font-size: 12px;
		font-weight: 500;
	}

	.or-divider::before,
	.or-divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: rgba(255, 255, 255, 0.06);
	}

	.import-form {
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 12px;
		padding: 20px;
		margin-bottom: 32px;
	}

	.import-form h3 {
		font-size: 15px;
		font-weight: 600;
		margin: 0 0 4px;
		color: #e4e4e7;
	}

	.couple-presets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 12px;
	}

	.preset-btn {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #71717a;
		padding: 5px 10px;
		border-radius: 14px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.preset-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		color: #a1a1aa;
	}

	.preset-btn.active {
		background: rgba(99, 102, 241, 0.12);
		color: #818cf8;
		border-color: rgba(99, 102, 241, 0.25);
	}

	.import-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 12px;
	}

	.import-item {
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		padding: 12px;
	}

	.import-filename {
		display: block;
		font-size: 12px;
		font-weight: 500;
		color: #a1a1aa;
		margin-bottom: 8px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.import-item-fields {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 8px;
	}

	@media (max-width: 640px) {
		.import-item-fields {
			grid-template-columns: 1fr;
		}
	}

	.import-actions {
		display: flex;
		gap: 8px;
		margin-top: 16px;
	}

	.import-btn {
		background: #6366f1;
		color: #fff;
		border: none;
		padding: 10px 24px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: background 0.15s;
	}

	.import-btn:hover:not(:disabled) {
		background: #7c3aed;
	}

	.import-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.import-cancel {
		background: none;
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #71717a;
		padding: 10px 18px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.import-cancel:hover {
		color: #a1a1aa;
		border-color: rgba(255, 255, 255, 0.1);
	}

	.section-divider {
		height: 1px;
		background: rgba(255, 255, 255, 0.06);
		margin: 32px 0;
	}

	.view-all {
		margin-left: auto;
		color: #818cf8;
		text-decoration: none;
		font-size: 13px;
		font-weight: 500;
		transition: color 0.15s;
	}

	.view-all:hover {
		color: #a5b4fc;
	}

	.clip-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 16px;
	}

	h1 {
		font-size: 22px;
		font-weight: 600;
		margin: 0;
		letter-spacing: -0.02em;
	}

	.count {
		font-size: 13px;
		color: #52525b;
		font-weight: 500;
	}

	.drop-zone {
		position: relative;
		border: 1.5px dashed rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		padding: 48px 24px;
		text-align: center;
		cursor: pointer;
		transition: all 0.2s ease;
		margin-bottom: 32px;
		background: rgba(255, 255, 255, 0.01);
	}

	.drop-zone:hover {
		border-color: rgba(255, 255, 255, 0.15);
		background: rgba(255, 255, 255, 0.02);
	}

	.drop-zone.active {
		border-color: #6366f1;
		background: rgba(99, 102, 241, 0.04);
	}

	.drop-zone.importing {
		border-color: #6366f1;
		opacity: 0.7;
		pointer-events: none;
	}

	.drop-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.drop-icon {
		color: #3f3f46;
		margin-bottom: 4px;
	}

	.drop-zone:hover .drop-icon,
	.drop-zone.active .drop-icon {
		color: #6366f1;
	}

	.drop-title {
		color: #a1a1aa;
		margin: 0;
		font-size: 14px;
		font-weight: 500;
	}

	.drop-sub {
		color: #52525b;
		margin: 0;
		font-size: 13px;
	}

	.drop-zone input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}

	.empty-state {
		text-align: center;
		padding: 60px 20px;
	}

	.empty-state p {
		color: #52525b;
		margin: 0;
		font-size: 15px;
		font-weight: 500;
	}

	.empty-sub {
		margin-top: 4px !important;
		font-size: 13px !important;
		font-weight: 400 !important;
		color: #3f3f46 !important;
	}

	.video-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 16px;
	}

	.video-card {
		background: #18181b;
		border-radius: 10px;
		overflow: hidden;
		text-decoration: none;
		color: inherit;
		border: 1px solid rgba(255, 255, 255, 0.04);
		transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
	}

	.video-card:hover {
		border-color: rgba(255, 255, 255, 0.08);
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
	}

	.video-thumb {
		aspect-ratio: 16 / 9;
		background: #0f0f12;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		overflow: hidden;
	}

	.video-thumb img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.3s;
	}

	.video-card:hover .video-thumb img {
		transform: scale(1.03);
	}

	.play-overlay {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.08);
		display: flex;
		align-items: center;
		justify-content: center;
		color: #52525b;
		transition: all 0.2s;
	}

	.play-overlay svg {
		margin-left: 2px;
	}

	.video-card:hover .play-overlay {
		background: rgba(99, 102, 241, 0.15);
		color: #818cf8;
	}

	.vid-duration {
		position: absolute;
		bottom: 8px;
		right: 8px;
		background: rgba(0, 0, 0, 0.75);
		color: #d4d4d8;
		font-size: 11px;
		padding: 3px 7px;
		border-radius: 4px;
		font-family: 'Inter', monospace;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.video-info {
		padding: 12px 14px 14px;
	}

	.video-info h3 {
		margin: 0 0 8px;
		font-size: 13px;
		font-weight: 500;
		color: #d4d4d8;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.video-actions {
		display: flex;
		gap: 6px;
	}

	.action-icon-btn {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #71717a;
		cursor: pointer;
		padding: 5px 10px;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 500;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.action-icon-btn:hover {
		color: #a1a1aa;
		background: rgba(255, 255, 255, 0.08);
	}

	.delete-btn:hover {
		color: #ef4444 !important;
		background: rgba(239, 68, 68, 0.06) !important;
		border-color: rgba(239, 68, 68, 0.15) !important;
	}

	.rename-row {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.rename-input {
		flex: 1;
		min-width: 0;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(99, 102, 241, 0.4);
		color: #e4e4e7;
		padding: 6px 8px;
		border-radius: 6px;
		font-size: 13px;
		font-family: 'Inter', sans-serif;
		outline: none;
		box-sizing: border-box;
	}

	.rename-ext {
		color: #52525b;
		font-size: 12px;
		flex-shrink: 0;
	}

	@media (max-width: 640px) {
		.video-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
