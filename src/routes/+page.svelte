<script lang="ts">
	import * as store from '$lib/store.svelte';
	import ClipCard from '$lib/components/ClipCard.svelte';
	import Dropdown from '$lib/components/Dropdown.svelte';
	import { computeFingerprint } from '$lib/fingerprint';
	import { getMp4Duration, checkVideoCodec } from '$lib/mp4-duration';

	// Svelte action: sets video/img src only when element enters viewport
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
	let dragOver = $state(false);
	let importing = $state(false);
	let importProgress = $state('');
	let editingId = $state<string | null>(null);

	// Filters
	let searchQuery = $state('');
	let filterDance = $state('');
	let filterStyle = $state('');
	let filterMastery = $state('');
	let filterType = $state('');
	let filterLead = $state('');
	let filterFollow = $state('');
	let selectedTags = $state<string[]>([]);
	let sortBy = $state('newest');

	let hasFilters = $derived(searchQuery || filterDance || filterStyle || filterMastery || filterType || filterLead || filterFollow || selectedTags.length > 0);

	let allTags = $derived(() => {
		const tags = new Set<string>();
		for (const clip of allClips) {
			for (const tag of clip.tags) tags.add(tag);
		}
		return [...tags].sort();
	});

	// Include all known dancers + any from data
	let allFilterLeads = $derived(() => {
		const s = new Set<string>(leadOptions.map(o => o.value));
		for (const v of videos) { if (v.lead) s.add(v.lead); }
		for (const c of allClips) { if (c.lead) s.add(c.lead); }
		return [...s].sort();
	});

	let allFilterFollows = $derived(() => {
		const s = new Set<string>(followOptions.map(o => o.value));
		for (const v of videos) { if (v.follow) s.add(v.follow); }
		for (const c of allClips) { if (c.follow) s.add(c.follow); }
		return [...s].sort();
	});

	function sortItems<T extends { createdAt?: string; addedAt?: string; label?: string; name?: string }>(items: T[], sort: string): T[] {
		const sorted = [...items];
		switch (sort) {
			case 'newest':
				return sorted.sort((a, b) => ((b.createdAt || b.addedAt || '') > (a.createdAt || a.addedAt || '') ? 1 : -1));
			case 'oldest':
				return sorted.sort((a, b) => ((a.createdAt || a.addedAt || '') > (b.createdAt || b.addedAt || '') ? 1 : -1));
			case 'name':
				return sorted.sort((a, b) => (a.label || a.name || '').localeCompare(b.label || b.name || ''));
			default:
				return sorted;
		}
	}

	// When searching, include all clips (including sub-clips); otherwise top-level only
	let topLevelClips = $derived(allClips.filter(c => !c.parentClipId));
	let hasSearch = $derived(searchQuery.trim().length > 0);

	let filteredClips = $derived(() => {
		let result = hasSearch ? allClips : topLevelClips;
		// Apply visibility: hidden clips excluded from browse, hiddenFromSearch also excluded from search
		if (hasSearch) {
			result = result.filter(c => !c.hiddenFromSearch);
		} else {
			result = result.filter(c => !c.hidden);
		}
		if (filterDance) result = result.filter(c => c.dance === filterDance);
		if (filterStyle) result = result.filter(c => c.style === filterStyle);
		if (filterMastery) result = result.filter(c => c.mastery === filterMastery);
		if (filterType) result = result.filter(c => c.clipType === filterType);
		if (filterLead) result = result.filter(c => c.lead === filterLead);
		if (filterFollow) result = result.filter(c => c.follow === filterFollow);
		if (selectedTags.length > 0) result = result.filter(c => selectedTags.every(t => c.tags.includes(t)));
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(c =>
				c.label.toLowerCase().includes(q) ||
				c.videoName.toLowerCase().includes(q) ||
				(c.lead || '').toLowerCase().includes(q) ||
				(c.follow || '').toLowerCase().includes(q) ||
				c.tags.some(t => t.includes(q))
			);
		}
		return sortItems(result, sortBy);
	});

	function videoMatchesDancer(v: { name: string; lead: string; follow: string }, field: 'lead' | 'follow', value: string): boolean {
		// Check stored metadata first
		if (field === 'lead' && v.lead === value) return true;
		if (field === 'follow' && v.follow === value) return true;
		// Fallback: accent-insensitive fuzzy match against filename
		return stripAccents(v.name.toLowerCase()).includes(stripAccents(value.toLowerCase()));
	}

	function videoMatchesDance(v: { name: string; dance: string }, value: string): boolean {
		if (v.dance === value) return true;
		// Fallback: check filename
		return v.name.toLowerCase().includes(value.toLowerCase());
	}

	let filteredVideos = $derived(() => {
		let result = videos;
		// Apply visibility: hidden videos excluded from browse, hiddenFromSearch also excluded from search
		if (hasSearch) {
			result = result.filter(v => !v.hiddenFromSearch);
		} else {
			result = result.filter(v => !v.hidden);
		}
		if (filterDance) result = result.filter(v => videoMatchesDance(v, filterDance));
		if (filterLead) result = result.filter(v => videoMatchesDancer(v, 'lead', filterLead));
		if (filterFollow) result = result.filter(v => videoMatchesDancer(v, 'follow', filterFollow));
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(v => v.name.toLowerCase().includes(q) || (v.lead || '').toLowerCase().includes(q) || (v.follow || '').toLowerCase().includes(q));
		}
		return sortItems(result, sortBy);
	});

	const coupleProfiles = [
		{ lead: 'Anthony', follow: 'Katie', img: '/couples/anthony-katie.jpg', label: 'Anthony & Katie' },
		{ lead: 'Cornel', follow: 'Rithika', img: '/couples/cornel-rithika.jpg', label: 'Cornel & Rithika' },
		{ lead: 'Emilien', follow: 'Tehina', img: '/couples/emilien-tehina.jpg', label: 'Emilien & Tehina' },
		{ lead: 'Gero', follow: 'Migle', img: '/couples/gero-migle.jpg', label: 'Gero & Migle' },
		{ lead: 'Irakli', follow: 'Maria', img: '/couples/irakli-maria.jpg', label: 'Irakli & Maria' },
		{ lead: 'Luis', follow: 'Andrea', img: '/couples/luis-andrea.jpg', label: 'Luis & Andrea' },
		{ lead: 'Marcus', follow: 'Bianca', img: '/couples/marcus-bianca.jpg', label: 'Marcus & Bianca' },
		{ lead: 'Melvin', follow: 'Gatica', img: '/couples/melvin-gatica.jpg', label: 'Melvin & Gatica' },
		{ lead: 'Miguel', follow: 'Sunsire', img: '/couples/miguel-sunsire.jpg', label: 'Miguel & Sunsire' },
		{ lead: 'Ofir', follow: 'Ofri', img: '/couples/ofir-ofri.jpg', label: 'Ofir & Ofri' },
		{ lead: 'Favian', follow: '', img: '/couples/favian.jpg', label: 'Favian' },
	];

	function selectCouple(lead: string, follow: string) {
		if (filterLead === lead && filterFollow === follow) {
			filterLead = '';
			filterFollow = '';
		} else {
			filterLead = lead;
			filterFollow = follow;
		}
	}

	function clearFilters() {
		searchQuery = '';
		filterDance = '';
		filterStyle = '';
		filterMastery = '';
		filterType = '';
		filterLead = '';
		filterFollow = '';
		selectedTags = [];
	}

	function toggleTag(tag: string) {
		if (selectedTags.includes(tag)) {
			selectedTags = selectedTags.filter(t => t !== tag);
		} else {
			selectedTags = [...selectedTags, tag];
		}
	}

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
		['Anthony', 'Katie'],
		['Cornel', 'Rithika'],
		['Emilien', 'Tehina'],
		['Gero', 'Migle'],
		['Irakli', 'Maria'],
		['Luis', 'Andrea'],
		['Marcus', 'Bianca'],
		['Melvin', 'Gatica'],
		['Miguel', 'Sunsire'],
		['Ofir', 'Ofri'],
	];
	const extraLeads = ['Favian'];
	const allKnownNames = [...couples.flat(), ...extraLeads];
	const leadOptions = [...new Set([...couples.map(c => c[0]), ...extraLeads])].sort().map(n => ({ value: n, label: n }));
	const followOptions = [...new Set(couples.map(c => c[1]))].sort().map(n => ({ value: n, label: n }));
	const danceOptions = [{ value: 'bachata', label: 'Bachata' }, { value: 'salsa', label: 'Salsa' }];

	function stripAccents(s: string): string {
		// NFKD handles both accents (é→e) and decorative Unicode (𝖬→M, ℌ→H, etc.)
		return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
	}

	function detectDancersFromFilename(filename: string): { lead: string; follow: string } {
		const name = stripAccents(filename.toLowerCase().replace(/[_\-\.]/g, ' '));

		// Try to find a couple match first
		for (const [lead, follow] of couples) {
			const leadNorm = stripAccents(lead.toLowerCase());
			const followNorm = stripAccents(follow.toLowerCase());
			if (name.includes(leadNorm) && name.includes(followNorm)) {
				return { lead, follow };
			}
		}

		// Try fuzzy: check for partial matches (at least 3 chars)
		for (const [lead, follow] of couples) {
			const leadNorm = stripAccents(lead.toLowerCase());
			const followNorm = stripAccents(follow.toLowerCase());
			const hasLead = leadNorm.length >= 3 && name.includes(leadNorm.slice(0, 3));
			const hasFollow = followNorm.length >= 3 && name.includes(followNorm.slice(0, 3));
			if (hasLead && hasFollow) {
				return { lead, follow };
			}
		}

		// Try to find any single known name
		let foundLead = '';
		let foundFollow = '';
		for (const [lead, follow] of couples) {
			if (name.includes(stripAccents(lead.toLowerCase()))) {
				foundLead = lead;
				foundFollow = follow;
				break;
			}
			if (name.includes(stripAccents(follow.toLowerCase()))) {
				foundLead = lead;
				foundFollow = follow;
				break;
			}
		}
		for (const lead of extraLeads) {
			if (name.includes(stripAccents(lead.toLowerCase()))) {
				foundLead = lead;
				break;
			}
		}

		if (foundLead || foundFollow) {
			return { lead: foundLead, follow: foundFollow };
		}

		// Default
		return { lead: 'Irakli', follow: 'Maria' };
	}

	function detectDanceFromFilename(filename: string): string {
		const name = filename.toLowerCase();
		if (name.includes('salsa')) return 'salsa';
		return 'bachata';
	}

	let thumbsLoading = $state(false);
	$effect(() => {
		const vids = videos;
		if (thumbsLoading || vids.length === 0) return;
		const missing = vids.filter(v => !thumbnailUrls[v.id]);
		if (missing.length === 0) return;
		thumbsLoading = true;
		Promise.allSettled(
			missing.map(async (video) => {
				const blob = await store.getVideoThumbnail(video.id);
				return blob ? { id: video.id, url: URL.createObjectURL(blob) } : null;
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

	let skippedCount = $state(0);

	async function stageFiles(files: FileList | null) {
		if (!files) return;

		// On filesystem mode, ensure a folder is selected before staging videos
		if (store.getStorageType() === 'filesystem' && store.getState() !== 'ready') {
			try {
				await store.pickFolder();
			} catch {
				return; // User cancelled folder picker
			}
			if (store.getState() !== 'ready') return;
		}
		const existingNames = new Set(videos.map(v => v.name));
		const videoFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.mp4') || f.type === 'video/mp4');
		const duplicates = videoFiles.filter(f => existingNames.has(f.name));
		const newFiles = videoFiles.filter(f => !existingNames.has(f.name));

		let filesToImport = newFiles;
		if (duplicates.length > 0) {
			const names = duplicates.map(f => f.name).join(', ');
			if (confirm(`${duplicates.length} video(s) already exist:\n${names}\n\nOverwrite?`)) {
				filesToImport = videoFiles; // include duplicates
			}
		}

		skippedCount = videoFiles.length - filesToImport.length;
		if (filesToImport.length === 0) return;
		pendingImports = filesToImport.map(file => {
			const { lead, follow } = detectDancersFromFilename(file.name);
			const dance = detectDanceFromFilename(file.name);
			return { file, lead, follow, dance };
		});
	}

	function applyCouple(l: string, f: string) {
		pendingImports = pendingImports.map(entry => ({ ...entry, lead: l, follow: f }));
	}

	async function confirmImport() {
		const toCheck = [...pendingImports];
		pendingImports = [];
		importing = true;

		// Check codecs first
		importProgress = 'Checking video codecs...';
		const skippedFiles: string[] = [];
		const toImport: typeof toCheck = [];
		for (const entry of toCheck) {
			const { supported, codec } = await checkVideoCodec(entry.file);
			if (supported) {
				toImport.push(entry);
			} else {
				skippedFiles.push(`${entry.file.name} (${codec})`);
				log(`[import] Skipped: ${entry.file.name} - unsupported codec: ${codec}`);
			}
		}

		if (skippedFiles.length > 0) {
			const msg = skippedFiles.length === 1
				? `Skipped 1 file with unsupported codec:\n${skippedFiles[0]}\n\nOnly H.264 and H.265 videos are supported. Use yt-dlp with -f "bestvideo[vcodec^=avc1]" or re-encode with ffmpeg.`
				: `Skipped ${skippedFiles.length} files with unsupported codecs:\n${skippedFiles.join('\n')}\n\nOnly H.264 and H.265 videos are supported. Use yt-dlp with -f "bestvideo[vcodec^=avc1]" or re-encode with ffmpeg.`;
			alert(msg);
		}

		if (toImport.length === 0) {
			importing = false;
			importProgress = '';
			return;
		}

		const total = toImport.length;
		importProgress = `Importing 0 of ${total}...`;

		for (let i = 0; i < toImport.length; i++) {
			const entry = toImport[i];
			importProgress = `Importing ${i + 1} of ${total}: ${entry.file.name}`;
			log(`[import] ${i + 1}/${total}: ${entry.file.name} (${(entry.file.size/1024/1024).toFixed(1)}MB)`);

			// Get duration from mp4 header (fast, no video element, works on iPad)
			let duration = await getMp4Duration(entry.file, log);
			log(`[import] mp4 header duration: ${duration}`);

			// Get fingerprint
			const fingerprint = await computeFingerprint(entry.file);

			// Try to get thumbnail via video element (best effort)
			let thumbnail: Blob | null = null;
			try {
				const info = await getVideoInfo(entry.file, 1);
				thumbnail = info.thumbnail;
				// Use video element duration if mp4 header failed
				if (duration === 0 && info.duration > 0) {
					duration = info.duration;
					log(`[import] fallback duration from video element: ${duration}`);
				}
			} catch {
				log(`[import] thumbnail generation failed, skipping`);
			}

			log(`[import] ${entry.file.name}: duration=${duration}, fp=${fingerprint.substring(0, 20)}...`);
			await store.addVideo(entry.file, duration, thumbnail, { lead: entry.lead, follow: entry.follow, dance: entry.dance }, fingerprint);
			log(`[import] ${entry.file.name}: saved`);
			if (i < toImport.length - 1) {
				await new Promise(r => setTimeout(r, 300));
			}
		}
		importProgress = '';
		importing = false;
	}

	function cancelImport() {
		pendingImports = [];
	}

	let debugLog = $state<string[]>([]);
	function log(msg: string) {
		console.log(msg);
		debugLog = [...debugLog.slice(-20), msg];
	}

	function getVideoInfo(file: File, retries = 2): Promise<{ duration: number; thumbnail: Blob | null }> {
		return new Promise((resolve) => {
			log(`[info] Reading ${file.name} (${(file.size/1024/1024).toFixed(1)}MB), retries=${retries}`);
			const video = document.createElement('video');
			video.preload = 'auto';
			video.muted = true;

			function cleanup() {
				URL.revokeObjectURL(video.src);
				video.removeAttribute('src');
				video.load(); // release resources
			}

			// Timeout - if metadata doesn't load in 15s, resolve with 0
			const timeout = setTimeout(() => {
				log(`[info] Timeout for ${file.name}`);
				cleanup();
				if (retries > 0) {
					setTimeout(() => getVideoInfo(file, retries - 1).then(resolve), 1000);
				} else {
					log(`[info] Giving up on ${file.name}, duration=0`);
					resolve({ duration: 0, thumbnail: null });
				}
			}, 15000);

			video.onloadedmetadata = () => {
				log(`[info] Metadata loaded: ${file.name}, duration=${video.duration}`);
				if (video.duration === 0 || isNaN(video.duration) || !isFinite(video.duration)) {
					clearTimeout(timeout);
					cleanup();
					if (retries > 0) {
						log(`[info] Invalid duration, retrying ${file.name}`);
						setTimeout(() => getVideoInfo(file, retries - 1).then(resolve), 1000);
					} else {
						resolve({ duration: 0, thumbnail: null });
					}
					return;
				}
				video.currentTime = Math.min(1, video.duration * 0.1);
			};

			video.onseeked = () => {
				clearTimeout(timeout);
				try {
					const canvas = document.createElement('canvas');
					canvas.width = video.videoWidth;
					canvas.height = video.videoHeight;
					const ctx = canvas.getContext('2d');
					if (ctx) {
						ctx.drawImage(video, 0, 0);
						canvas.toBlob(
							(blob) => {
								const dur = video.duration;
								cleanup();
								resolve({ duration: dur, thumbnail: blob });
							},
							'image/jpeg',
							0.8
						);
					} else {
						const dur = video.duration;
						cleanup();
						resolve({ duration: dur, thumbnail: null });
					}
				} catch {
					const dur = video.duration;
					cleanup();
					resolve({ duration: dur, thumbnail: null });
				}
			};

			video.onerror = () => {
				const err = video.error;
				log(`[info] Error loading ${file.name}: code=${err?.code} message=${err?.message}`);
				clearTimeout(timeout);
				cleanup();
				if (retries > 0) {
					setTimeout(() => getVideoInfo(file, retries - 1).then(resolve), 500);
				} else {
					resolve({ duration: 0, thumbnail: null });
				}
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
	{#if topLevelClips.length > 0 || videos.length > 0}
		<div class="filters">
			<div class="filter-header">
				<input
					type="text"
					class="search-input"
					placeholder="Search..."
					bind:value={searchQuery}
				/>
				<Dropdown
					bind:value={sortBy}
					options={[
						{ value: 'newest', label: 'Newest first' },
						{ value: 'oldest', label: 'Oldest first' },
						{ value: 'name', label: 'Name A-Z' }
					]}
					placeholder="Sort..."
				/>
				{#if hasFilters}
					<button class="clear-filters-btn" onclick={clearFilters}>Clear</button>
				{/if}
			</div>
			<div class="stories-row">
				{#each coupleProfiles as profile}
					<button
						class="story-item"
						class:active={filterLead === profile.lead && filterFollow === profile.follow}
						onclick={() => selectCouple(profile.lead, profile.follow)}
					>
						<div class="story-ring">
							<img src={profile.img} alt={profile.label} class="story-avatar" />
						</div>
						<span class="story-label">{profile.label}</span>
					</button>
				{/each}
			</div>
			<div class="filter-row">
				<Dropdown
					bind:value={filterDance}
					options={[{ value: 'bachata', label: 'Bachata' }, { value: 'salsa', label: 'Salsa' }]}
					placeholder="All dances"
				/>
				{#if allClips.length > 0}
					<Dropdown
						bind:value={filterStyle}
						options={[{ value: 'sensual', label: 'Sensual' }, { value: 'moderna', label: 'Moderna' }, { value: 'dominicana', label: 'Dominicana' }, { value: 'fusion', label: 'Fusion' }]}
						placeholder="All styles"
					/>
					<Dropdown
						bind:value={filterMastery}
						options={[{ value: 'seen', label: 'Seen it' }, { value: 'learning', label: 'Learning' }, { value: 'can do', label: 'Can do' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'mastered', label: 'Mastered' }]}
						placeholder="All mastery"
					/>
					<Dropdown
						bind:value={filterType}
						options={[{ value: 'move', label: 'Move' }, { value: 'pattern', label: 'Pattern' }, { value: 'styling', label: 'Styling' }, { value: 'footwork', label: 'Footwork' }]}
						placeholder="All types"
					/>
				{/if}
			</div>
			{#if allTags().length > 0}
				<div class="filter-tags">
					{#each allTags() as tag}
						<button
							class="filter-tag"
							class:active={selectedTags.includes(tag)}
							onclick={() => toggleTag(tag)}
						>{tag}</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if topLevelClips.length > 0}
		<div class="header">
			<h1>Clips</h1>
			<span class="count">{filteredClips().length}{hasFilters ? ` of ${topLevelClips.length}` : ''} clip{filteredClips().length === 1 ? '' : 's'}</span>
		</div>

		{#if filteredClips().length > 0}
			<div class="clip-grid">
				{#each filteredClips() as clip (clip.id)}
					<ClipCard {clip} />
				{/each}
			</div>
		{:else if hasFilters}
			<p class="no-results">No clips match your filters</p>
		{/if}
		<div class="section-divider"></div>
	{/if}

	<div class="header">
		<h1>Videos</h1>
		{#if videos.length > 0}
			<span class="count">{filteredVideos().length}{hasFilters ? ` of ${videos.length}` : ''} video{filteredVideos().length === 1 ? '' : 's'}</span>
		{/if}
	</div>

	{#if importing && importProgress}
		<div class="import-progress">
			<div class="import-progress-spinner"></div>
			<span>{importProgress}</span>
		</div>
	{/if}

	{#if debugLog.length > 0}
		<details class="debug-log">
			<summary>Debug log ({debugLog.length})</summary>
			<pre>{debugLog.join('\n')}</pre>
		</details>
	{/if}

	{#if pendingImports.length > 0}
		<div class="import-form">
			<h3>Import {pendingImports.length} video{pendingImports.length > 1 ? 's' : ''}</h3>
			{#if skippedCount > 0}
				<p class="skipped-notice">{skippedCount} already imported, skipped</p>
			{/if}

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
				accept=".mp4,video/mp4"
				multiple
				onchange={(e) => stageFiles((e.target as HTMLInputElement).files)}
			/>
		</div>
	{/if}

	{#if filteredVideos().length > 0}
		<div class="video-grid">
			{#each filteredVideos() as video}
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
						{#if store.isVideoLocal(video.id)}
							<span class="vid-source local">Local</span>
						{:else if video.cdnUrl}
							<span class="vid-source stream">Stream</span>
						{/if}
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

	.filters {
		margin-bottom: 24px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.filter-header {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.filter-header .search-input {
		flex: 1;
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

	.filter-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.filter-select {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		color: #a1a1aa;
		padding: 7px 28px 7px 10px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		font-family: 'Inter', sans-serif;
		cursor: pointer;
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%2352525b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 8px center;
		transition: border-color 0.15s;
	}

	.filter-select:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.4);
	}

	.filter-select option {
		background: #18181b;
		color: #e4e4e7;
	}

	.filter-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.filter-tag {
		background: rgba(255, 255, 255, 0.03);
		color: #71717a;
		border: 1px solid rgba(255, 255, 255, 0.06);
		padding: 4px 10px;
		border-radius: 14px;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.filter-tag:hover {
		background: rgba(255, 255, 255, 0.06);
		color: #a1a1aa;
	}

	.filter-tag.active {
		background: rgba(99, 102, 241, 0.12);
		color: #818cf8;
		border-color: rgba(99, 102, 241, 0.25);
	}

	.clear-filters-btn {
		margin-left: auto;
		background: none;
		border: none;
		color: #52525b;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: color 0.15s;
	}

	.clear-filters-btn:hover {
		color: #a1a1aa;
	}

	.no-results {
		color: #3f3f46;
		font-size: 14px;
		text-align: center;
		padding: 40px 20px;
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

	.import-progress {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 20px;
		background: rgba(99, 102, 241, 0.06);
		border: 1px solid rgba(99, 102, 241, 0.15);
		border-radius: 10px;
		margin-bottom: 20px;
		color: #a1a1aa;
		font-size: 13px;
		font-weight: 500;
	}

	.import-progress-spinner {
		width: 18px;
		height: 18px;
		border: 2px solid rgba(99, 102, 241, 0.2);
		border-top-color: #818cf8;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.debug-log {
		margin-bottom: 16px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		padding: 8px 12px;
		font-size: 11px;
		color: #52525b;
	}

	.debug-log summary {
		cursor: pointer;
		font-weight: 500;
		color: #71717a;
	}

	.debug-log pre {
		margin: 8px 0 0;
		white-space: pre-wrap;
		word-break: break-all;
		font-family: 'SF Mono', monospace;
		font-size: 10px;
		line-height: 1.6;
		max-height: 200px;
		overflow-y: auto;
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

	.skipped-notice {
		color: #fbbf24;
		font-size: 12px;
		margin: 4px 0 12px;
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

	.video-thumb img,
	.video-thumb-vid {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.3s;
		pointer-events: none;
	}

	.video-card:hover .video-thumb img,
	.video-card:hover .video-thumb-vid {
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

	.vid-source {
		position: absolute;
		top: 8px;
		left: 8px;
		font-size: 10px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: 4px;
		font-family: 'Inter', sans-serif;
		letter-spacing: 0.03em;
	}

	.vid-source.local {
		background: rgba(99, 102, 241, 0.85);
		color: #fff;
	}

	.vid-source.stream {
		background: rgba(52, 211, 153, 0.85);
		color: #fff;
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

	.stories-row {
		display: flex;
		gap: 14px;
		overflow-x: auto;
		padding: 4px 2px 8px;
		scrollbar-width: none;
		-ms-overflow-style: none;
	}

	.stories-row::-webkit-scrollbar {
		display: none;
	}

	.story-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
		font-family: 'Inter', sans-serif;
	}

	.story-ring {
		width: 66px;
		height: 66px;
		border-radius: 50%;
		padding: 3px;
		background: rgba(255, 255, 255, 0.08);
		transition: background 0.2s;
	}

	.story-item.active .story-ring {
		background: linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
	}

	.story-item:hover:not(.active) .story-ring {
		background: rgba(255, 255, 255, 0.15);
	}

	.story-avatar {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		object-fit: cover;
		border: 2.5px solid #09090b;
		display: block;
	}

	.story-label {
		font-size: 10px;
		color: #71717a;
		text-align: center;
		max-width: 72px;
		line-height: 1.3;
		transition: color 0.2s;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		word-break: break-word;
	}

	.story-item.active .story-label {
		color: #e4e4e7;
	}

	.story-item:hover .story-label {
		color: #a1a1aa;
	}
</style>
