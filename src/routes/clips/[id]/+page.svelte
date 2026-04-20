<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import * as store from '$lib/store.svelte';
	import { extractClip } from '$lib/ffmpeg';
	import Dropdown from '$lib/components/Dropdown.svelte';
	import MultiSelect from '$lib/components/MultiSelect.svelte';
	import ClipMarker from '$lib/components/ClipMarker.svelte';
	import ClipCard from '$lib/components/ClipCard.svelte';
	import { getMovesForDance } from '$lib/moves';
	import VideoPlayer from '$lib/components/VideoPlayer.svelte';

	let clipId = $derived($page.params.id ?? '');
	let clip = $derived(store.getClips().find(c => c.id === clipId));

	// Sub-clips
	let subClips = $derived(store.getSubClips(clipId));
	let showSubClipForm = $state(false);
	let subClipIn = $state<number | null>(null);
	let subClipOut = $state<number | null>(null);
	let subClipCurrentTime = $state(0);
	let subClipDuration = $state(0);

	// Parent clip
	let parentClip = $derived(clip?.parentClipId ? store.getClips().find(c => c.id === clip!.parentClipId) : null);

	// Links
	let clipLinks = $derived(store.getLinksForClip(clipId));
	let showLinkPicker = $state(false);
	let linkPickerTab = $state<'clips' | 'videos'>('clips');
	let linkPickerSearch = $state('');
	let linkPickerLabel = $state('related');
	const linkLabels = ['breakdown', 'variation', 'tutorial', 'related'];

	let linkableClips = $derived(() => {
		const q = linkPickerSearch.toLowerCase();
		return store.getClips()
			.filter(c => c.id !== clipId && !clipLinks.some(l => l.id === c.id))
			.filter(c => !q || c.label.toLowerCase().includes(q) || c.videoName.toLowerCase().includes(q));
	});

	let linkableVideos = $derived(() => {
		const q = linkPickerSearch.toLowerCase();
		return store.getVideos()
			.filter(v => !clipLinks.some(l => l.id === v.id))
			.filter(v => !q || v.name.toLowerCase().includes(q));
	});

	async function addLinkTo(targetId: string, targetType: 'clip' | 'video') {
		await store.addLink(clipId, targetId, targetType, linkPickerLabel);
		showLinkPicker = false;
		linkPickerSearch = '';
	}

	async function removeLinkFrom(targetId: string) {
		await store.removeLink(clipId, targetId);
	}

	let videoUrl = $state<string | null>(null);

	// Editable fields
	let label = $state('');
	let lead = $state('');
	let follow = $state('');
	let dance = $state('');
	let style = $state('');
	let mastery = $state('');
	let clipType = $state('');
	let tags = $state<string[]>([]);
	let editHidden = $state(false);
	let editHiddenFromSearch = $state(false);
	let dirty = $state(false);
	let saving = $state(false);

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
	const styles = ['sensual', 'moderna', 'dominicana', 'fusion'];
	const masteryLevels = [
		{ value: 'seen', label: 'Seen it' },
		{ value: 'learning', label: 'Learning' },
		{ value: 'can do', label: 'Can do' },
		{ value: 'comfortable', label: 'Comfortable' },
		{ value: 'mastered', label: 'Mastered' },
	];
	const clipTypes = ['move', 'pattern', 'styling', 'footwork', 'musicality'];

	let moveOptions = $derived(getMovesForDance(dance));

	function selectCouple(l: string, f: string) {
		lead = l;
		follow = f;
		dirty = true;
	}

	let clipDurationVal = $derived(clip ? clip.endTime - clip.startTime : 0);

	$effect(() => {
		const state = store.getState();
		if (state !== 'ready') return;
		if (!clip) {
			goto('/');
			return;
		}

		// Load source video URL
		let revokeVideoUrl: (() => void) | null = null;
		store.getVideoUrl(clip.videoId).then(({ url, revoke }) => {
			videoUrl = url;
			revokeVideoUrl = revoke;
		});

		// Populate form fields
		label = clip.label;
		lead = clip.lead || '';
		follow = clip.follow || '';
		dance = clip.dance || '';
		style = clip.style || '';
		mastery = clip.mastery || '';
		clipType = clip.clipType || '';
		tags = [...(clip.tags || [])];
		editHidden = clip.hidden ?? false;
		editHiddenFromSearch = clip.hiddenFromSearch ?? false;
		dirty = false;

		return () => {
			if (revokeVideoUrl) revokeVideoUrl();
		};
	});

	let initialized = $state(false);

	// Mark dirty on any field change, but skip the initial population
	$effect(() => {
		label; lead; follow; dance; style; mastery; clipType; tags; editHidden; editHiddenFromSearch;
		if (initialized) {
			dirty = true;
		}
	});

	// Set initialized after first render tick so the effect above skips initial values
	$effect(() => {
		if (clip && store.getState() === 'ready' && !initialized) {
			// Use a timeout to let the initial field population settle
			setTimeout(() => { initialized = true; }, 100);
		}
	});

	async function save() {
		if (!clip) return;
		saving = true;
		await store.updateClip(clip.id, {
			label: label.trim(),
			lead,
			follow,
			dance,
			style,
			mastery,
			clipType,
			tags,
			hidden: editHidden,
			hiddenFromSearch: editHiddenFromSearch
		});
		dirty = false;
		saving = false;
		// Reset so next changes are tracked
		initialized = true;
	}

	async function deleteClip() {
		if (!clip) return;
		if (confirm('Delete this clip?')) {
			await store.deleteClip(clip.id);
			goto('/');
		}
	}

	let downloadingClip = $state(false);

	async function download() {
		if (!clip) return;
		downloadingClip = true;
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
			downloadingClip = false;
		}
	}

	let currentTime = $state(0);

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}
</script>

{#if clip && videoUrl}
	<div class="clip-page">
		<div class="top-bar">
			<a href="/" class="back">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="15 18 9 12 15 6" />
				</svg>
				Back
			</a>
			<div class="top-actions">
				<button class="top-btn" onclick={download} disabled={downloadingClip}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
					</svg>
					{downloadingClip ? 'Extracting...' : 'Download'}
				</button>
				<button class="top-btn danger" onclick={deleteClip}>Delete</button>
			</div>
		</div>

		<div class="layout">
			<div class="editor-main">
				<VideoPlayer
					src={videoUrl}
					bind:currentTime={currentTime}
					bind:duration={subClipDuration}
					clipStart={clip.startTime}
					clipEnd={clip.endTime}
					clips={subClips}
					onSetIn={(t) => subClipIn = t}
					onSetOut={(t) => subClipOut = t}
				/>

				<div class="marker-section">
					<ClipMarker
						videoId={clip.videoId}
						videoName={clip.videoName}
						videoLead={clip.lead}
						videoFollow={clip.follow}
						videoDance={clip.dance}
						bind:inPoint={subClipIn}
						bind:outPoint={subClipOut}
						parentClipId={clip.id}
						parentClipLabel={clip.label}
						onClipSaved={() => { subClipIn = null; subClipOut = null; }}
					/>
				</div>
			</div>

			<div class="edit-section">
				<div class="edit-header">
					<h1>{clip.label}</h1>
					{#if parentClip}
						<a href="/clips/{parentClip.id}" class="parent-link">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="15 18 9 12 15 6" />
							</svg>
							Part of: {parentClip.label}
						</a>
					{/if}
					<a href="/videos/{clip.videoId}" class="source-link">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
						</svg>
						{clip.videoName} - {formatTime(clip.startTime)} to {formatTime(clip.endTime)}
					</a>
				</div>

				<div class="edit-form">
					<span class="form-section-label">Clip details</span>
					<input
						type="text"
						placeholder="Move name"
						bind:value={label}
					/>

					<div class="form-row">
						<Dropdown label="Style" bind:value={style} options={styles.map(s => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} />
						<Dropdown label="Mastery" bind:value={mastery} options={masteryLevels} />
						<Dropdown label="Type" bind:value={clipType} options={clipTypes.map(t => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))} />
					</div>

					<MultiSelect
						label="Moves / Tags"
						bind:selected={tags}
						options={moveOptions}
						placeholder="Search moves..."
					/>

					<div class="form-divider"></div>

					<span class="form-section-label">From video</span>

					<div class="couple-presets">
						{#each couples as [l, f]}
							<button
								type="button"
								class="preset-btn"
								class:active={lead === l && follow === f}
								onclick={() => selectCouple(l, f)}
							>{l} & {f}</button>
						{/each}
					</div>

					<div class="form-row">
						<Dropdown label="Lead" bind:value={lead} options={leadOptions} placeholder="Select lead..." />
						<Dropdown label="Follow" bind:value={follow} options={followOptions} placeholder="Select follow..." />
					</div>

					<div class="form-row form-row-2">
						<Dropdown label="Dance" bind:value={dance} options={[{ value: 'bachata', label: 'Bachata' }, { value: 'salsa', label: 'Salsa' }]} />
					</div>

					<div class="visibility-options">
						<button type="button" class="vis-toggle" class:active={editHidden} onclick={() => editHidden = !editHidden}>Hide from home</button>
						<button type="button" class="vis-toggle" class:active={editHiddenFromSearch} onclick={() => editHiddenFromSearch = !editHiddenFromSearch}>Hide from search</button>
					</div>

					<button class="save-btn" onclick={save} disabled={saving}>
						{#if saving}
							<span class="spinner"></span>
							Saving...
						{:else}
							Save Changes
						{/if}
					</button>
				</div>

				{#if subClips.length > 0}
					<!-- Sub-clips section -->
					<div class="section-block">
						<div class="section-block-header">
							<span class="form-section-label">Sub-clips</span>
							<span class="section-count">{subClips.length}</span>
						</div>
						<div class="sub-clips-grid">
							{#each subClips as subClip (subClip.id)}
								<ClipCard clip={subClip} />
							{/each}
						</div>
					</div>
				{/if}

				<!-- Related / Links section -->
				<div class="section-block">
					<div class="section-block-header">
						<span class="form-section-label">Related</span>
						{#if clipLinks.length > 0}
							<span class="section-count">{clipLinks.length}</span>
						{/if}
					</div>

					{#if clipLinks.length > 0}
						<div class="links-list">
							{#each clipLinks as link}
								<div class="link-item">
									<a href="/{link.type === 'clip' ? 'clips' : 'videos'}/{link.id}" class="link-item-info">
										<span class="link-label-badge">{link.label}</span>
										<span class="link-name">
											{#if link.type === 'clip'}
												{@const targetClip = store.getClips().find(c => c.id === link.id)}
												{targetClip?.label ?? 'Unknown clip'}
											{:else}
												{@const targetVideo = store.getVideos().find(v => v.id === link.id)}
												{targetVideo?.name ?? 'Unknown video'}
											{/if}
										</span>
									</a>
									<button class="link-remove" onclick={() => removeLinkFrom(link.id)} title="Remove link">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
									</button>
								</div>
							{/each}
						</div>
					{/if}

					{#if showLinkPicker}
						<div class="link-picker">
							<div class="link-picker-header">
								<div class="link-picker-tabs">
									<button class="picker-tab" class:active={linkPickerTab === 'clips'} onclick={() => linkPickerTab = 'clips'}>Clips</button>
									<button class="picker-tab" class:active={linkPickerTab === 'videos'} onclick={() => linkPickerTab = 'videos'}>Videos</button>
								</div>
								<button class="link-picker-close" title="Close" onclick={() => { showLinkPicker = false; linkPickerSearch = ''; }}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
								</button>
							</div>
							<input type="text" class="link-picker-search" placeholder="Search..." bind:value={linkPickerSearch} />
							<div class="link-picker-label-row">
								<span class="link-picker-label-text">Relationship:</span>
								{#each linkLabels as lbl}
									<button class="link-label-option" class:active={linkPickerLabel === lbl} onclick={() => linkPickerLabel = lbl}>{lbl}</button>
								{/each}
							</div>
							<div class="link-picker-results">
								{#if linkPickerTab === 'clips'}
									{#each linkableClips() as c}
										<button class="link-picker-item" onclick={() => addLinkTo(c.id, 'clip')}>
											<span class="picker-item-name">{c.label}</span>
											<span class="picker-item-meta">{c.videoName}</span>
										</button>
									{:else}
										<p class="picker-empty">No clips to link</p>
									{/each}
								{:else}
									{#each linkableVideos() as v}
										<button class="link-picker-item" onclick={() => addLinkTo(v.id, 'video')}>
											<span class="picker-item-name">{v.name}</span>
										</button>
									{:else}
										<p class="picker-empty">No videos to link</p>
									{/each}
								{/if}
							</div>
						</div>
					{:else}
						<button class="section-action-btn" onclick={() => showLinkPicker = true}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
								<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
							</svg>
							Link video or clip
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
{:else}
	<div class="loading">
		<div class="loading-spinner"></div>
	</div>
{/if}

<style>
	.clip-page {
		max-width: 1200px;
		margin: 0 auto;
		overflow-x: hidden;
	}

	.top-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 20px;
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

	.top-actions {
		display: flex;
		gap: 8px;
	}

	.top-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		background: rgba(255, 255, 255, 0.04);
		color: #a1a1aa;
		border: 1px solid rgba(255, 255, 255, 0.06);
		padding: 7px 14px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.top-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
	}

	.top-btn.danger:hover {
		color: #ef4444;
		border-color: rgba(239, 68, 68, 0.2);
		background: rgba(239, 68, 68, 0.06);
	}

	.layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: 24px;
	}

	@media (min-width: 900px) {
		.layout {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}
	}

	.player-section {
		position: sticky;
		top: 76px;
	}

	.player-wrapper {
		background: #000;
		border-radius: 10px;
		overflow: hidden;
		line-height: 0;
	}

	.player-wrapper video {
		width: 100%;
		display: block;
		max-height: 50vh;
		object-fit: contain;
		cursor: pointer;
		background: #000;
	}

	:global(.player-section:fullscreen),
	.fake-fullscreen {
		background: #000;
		display: flex;
		flex-direction: column;
	}

	:global(.player-section:fullscreen .player-wrapper),
	.fake-fullscreen .player-wrapper {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	:global(.player-section:fullscreen video),
	.fake-fullscreen video {
		max-height: 100vh;
		max-width: 100vw;
		object-fit: contain;
	}

	.fake-fullscreen {
		position: fixed;
		inset: 0;
		z-index: 9999;
	}

	.timeline {
		position: relative;
		height: 24px;
		cursor: pointer;
		padding: 8px 0;
	}

	.timeline-track {
		position: relative;
		height: 4px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 2px;
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

	.clip-time {
		font-size: 12px;
		color: #71717a;
		font-variant-numeric: tabular-nums;
		font-family: 'Inter', monospace;
		margin-left: 4px;
	}

	.time-sep {
		color: #3f3f46;
		margin: 0 3px;
	}

	.player-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 0 10px;
		gap: 8px;
		flex-wrap: wrap;
	}

	.controls-left {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
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

	.loop-toggle.active {
		color: #818cf8;
	}

	.loop-toggle:not(.active) {
		color: #3f3f46;
	}

	.clip-duration {
		font-size: 12px;
		color: #52525b;
		font-variant-numeric: tabular-nums;
		margin-left: 4px;
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
		padding: 5px 7px;
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
	}

	.mark-btn {
		background: rgba(99, 102, 241, 0.1);
		color: #818cf8;
		border: 1px solid rgba(99, 102, 241, 0.2);
		padding: 5px 12px;
		border-radius: 6px;
		cursor: pointer;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.mark-btn:hover {
		background: rgba(99, 102, 241, 0.18);
		border-color: rgba(99, 102, 241, 0.35);
	}

	.edit-section {
		background: #18181b;
		border-radius: 12px;
		padding: 24px;
		border: 1px solid rgba(255, 255, 255, 0.04);
		min-width: 0;
		overflow: hidden;
	}

	@media (max-width: 640px) {
		.edit-section {
			padding: 16px;
		}
	}

	.edit-header {
		margin-bottom: 20px;
	}

	.edit-header h1 {
		font-size: 20px;
		font-weight: 600;
		margin: 0 0 4px;
		letter-spacing: -0.02em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.source-link {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: #71717a;
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
		font-variant-numeric: tabular-nums;
		transition: color 0.15s;
		padding: 8px 14px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		margin-top: 8px;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.source-link:hover {
		color: #818cf8;
		border-color: rgba(99, 102, 241, 0.2);
		background: rgba(99, 102, 241, 0.04);
	}

	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.form-section-label {
		font-size: 11px;
		text-transform: uppercase;
		color: #52525b;
		font-weight: 600;
		letter-spacing: 0.06em;
	}

	.form-divider {
		height: 1px;
		background: rgba(255, 255, 255, 0.06);
		margin: 6px 0;
	}

	input {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #e4e4e7;
		padding: 10px 14px;
		border-radius: 8px;
		font-size: 13px;
		font-family: 'Inter', sans-serif;
		transition: border-color 0.15s;
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}

	input::placeholder {
		color: #3f3f46;
	}

	input:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
	}

	.couple-presets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
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

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		min-width: 0;
	}

	.form-row-4 {
		grid-template-columns: 1fr 1fr;
	}

	@media (max-width: 400px) {
		.form-row {
			grid-template-columns: 1fr;
		}
		.form-row-4 {
			grid-template-columns: 1fr;
		}
	}

	@media (min-width: 500px) {
		.form-row-4 {
			grid-template-columns: 1fr 1fr 1fr 1fr;
		}
	}

	.visibility-options {
		display: flex;
		gap: 6px;
		margin-bottom: 12px;
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

	.save-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		background: #6366f1;
		color: #fff;
		border: none;
		padding: 11px 20px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: background 0.15s, opacity 0.15s;
		margin-top: 4px;
	}

	.save-btn:hover:not(:disabled) {
		background: #7c3aed;
	}

	.save-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
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

	/* Parent link */
	.parent-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: #818cf8;
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
		padding: 6px 12px;
		background: rgba(99, 102, 241, 0.06);
		border: 1px solid rgba(99, 102, 241, 0.15);
		border-radius: 8px;
		margin-top: 6px;
		transition: all 0.15s;
	}

	.parent-link:hover {
		background: rgba(99, 102, 241, 0.12);
		border-color: rgba(99, 102, 241, 0.3);
	}

	/* Section blocks (sub-clips, links) */
	.section-block {
		margin-top: 20px;
		padding-top: 16px;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}

	.section-block-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}

	.section-count {
		background: rgba(255, 255, 255, 0.06);
		color: #71717a;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: 10px;
	}

	.section-action-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		background: rgba(255, 255, 255, 0.03);
		color: #71717a;
		border: 1px solid rgba(255, 255, 255, 0.06);
		padding: 8px 14px;
		border-radius: 8px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
		width: 100%;
		justify-content: center;
	}

	.section-action-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		color: #a1a1aa;
		border-color: rgba(255, 255, 255, 0.1);
	}

	/* Sub-clips grid */
	.sub-clips-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 10px;
		margin-bottom: 12px;
	}

	.sub-clip-editor {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 12px;
	}

	/* Links list */
	.links-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 12px;
	}

	.link-item {
		display: flex;
		align-items: center;
		gap: 8px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		padding: 8px 10px;
		transition: border-color 0.15s;
	}

	.link-item:hover {
		border-color: rgba(255, 255, 255, 0.1);
	}

	.link-item-info {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		text-decoration: none;
		color: inherit;
		min-width: 0;
	}

	.link-label-badge {
		background: rgba(99, 102, 241, 0.1);
		color: #818cf8;
		padding: 2px 7px;
		border-radius: 4px;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		flex-shrink: 0;
	}

	.link-name {
		font-size: 13px;
		color: #a1a1aa;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color 0.15s;
	}

	.link-item-info:hover .link-name {
		color: #e4e4e7;
	}

	.link-remove {
		background: none;
		border: none;
		color: #3f3f46;
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.15s, background 0.15s;
		flex-shrink: 0;
	}

	.link-remove:hover {
		color: #ef4444;
		background: rgba(239, 68, 68, 0.08);
	}

	/* Link picker */
	.link-picker {
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 10px;
		padding: 12px;
	}

	.link-picker-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
	}

	.link-picker-tabs {
		display: flex;
		gap: 2px;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 6px;
		padding: 2px;
	}

	.picker-tab {
		background: none;
		border: none;
		color: #52525b;
		padding: 5px 12px;
		border-radius: 5px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.picker-tab.active {
		background: rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
	}

	.picker-tab:hover:not(.active) {
		color: #a1a1aa;
	}

	.link-picker-close {
		background: none;
		border: none;
		color: #52525b;
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		transition: color 0.15s;
	}

	.link-picker-close:hover {
		color: #a1a1aa;
	}

	.link-picker-search {
		width: 100%;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #e4e4e7;
		padding: 8px 12px;
		border-radius: 6px;
		font-size: 12px;
		font-family: 'Inter', sans-serif;
		margin-bottom: 8px;
		box-sizing: border-box;
	}

	.link-picker-search::placeholder {
		color: #3f3f46;
	}

	.link-picker-search:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
	}

	.link-picker-label-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 10px;
		flex-wrap: wrap;
	}

	.link-picker-label-text {
		font-size: 11px;
		color: #52525b;
		font-weight: 500;
	}

	.link-label-option {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #71717a;
		padding: 3px 8px;
		border-radius: 4px;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.link-label-option.active {
		background: rgba(99, 102, 241, 0.12);
		color: #818cf8;
		border-color: rgba(99, 102, 241, 0.25);
	}

	.link-label-option:hover:not(.active) {
		color: #a1a1aa;
	}

	.link-picker-results {
		max-height: 200px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.link-picker-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: none;
		border: none;
		color: inherit;
		padding: 8px 10px;
		border-radius: 6px;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		text-align: left;
		transition: background 0.15s;
	}

	.link-picker-item:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	.picker-item-name {
		font-size: 13px;
		color: #e4e4e7;
		font-weight: 500;
	}

	.picker-item-meta {
		font-size: 11px;
		color: #52525b;
	}

	.picker-empty {
		color: #3f3f46;
		font-size: 12px;
		text-align: center;
		padding: 16px;
		margin: 0;
	}
</style>
