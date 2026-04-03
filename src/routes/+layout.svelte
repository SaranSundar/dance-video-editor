<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import * as store from '$lib/store.svelte';

	let { children }: { children: Snippet } = $props();
	let currentPath = $derived($page.url.pathname);
	let state = $derived(store.getState());
	let folderName = $derived(store.getFolderName());
	let storageType = $derived(store.getStorageType());
	let isPwa = $state(false);
	let showCdnSettings = $state(false);
	let cdnBaseUrlInput = $state(store.getCdnBaseUrl());

	function saveCdnBaseUrl() {
		store.setCdnBaseUrl(cdnBaseUrlInput);
		showCdnSettings = false;
	}
	let exporting = $state(false);
	let importing = $state(false);
	let progressPct = $state(0);
	let progressMsg = $state('');
	async function handleExport() {
		exporting = true;
		progressPct = 0;
		progressMsg = 'Exporting metadata...';
		try {
			const json = await store.exportMetadata();
			const blob = new Blob([json], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `clipit-metadata-${new Date().toISOString().slice(0, 10)}.json`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			alert(`Export failed: ${e}`);
		} finally {
			exporting = false;
			progressPct = 0;
			progressMsg = '';
		}
	}

	async function handleImport(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = input.files;
		if (!files || files.length === 0) return;
		const file = files[0];
		input.value = '';

		if (!file.name.endsWith('.json')) {
			alert('Please select a .json metadata file.');
			return;
		}

		if (!confirm('Import this metadata file? Clips will be replaced.')) return;

		importing = true;
		progressPct = 0;
		progressMsg = `Importing ${file.name}...`;
		try {
			const text = await file.text();
			await store.importMetadata(text);
			progressPct = 100;
			progressMsg = 'Done';
		} catch (err) {
			alert(`Import failed: ${err}`);
		} finally {
			importing = false;
			progressPct = 0;
			progressMsg = '';
		}
	}

	let updating = $state(false);

	async function handleUpdate() {
		updating = true;
		try {
			if ('serviceWorker' in navigator) {
				const reg = await navigator.serviceWorker.getRegistration();
				if (reg) {
					await reg.update();
					const cacheKeys = await caches.keys();
					await Promise.all(cacheKeys.map(k => caches.delete(k)));
				}
			}
			window.location.reload();
		} catch {
			window.location.reload();
		}
	}

	async function handleNuke() {
		if (!confirm('Delete ALL videos and clips? This cannot be undone.')) return;
		if (!confirm('Are you really sure? Everything will be permanently deleted.')) return;
		try {
			await store.nukeAll();
		} catch (e) {
			alert(`Failed: ${e}`);
		}
	}

	let consoleLogs = $state<string[]>([]);
	let showConsole = $state(false);

	onMount(() => {
		// Intercept console.log and console.error to show in UI
		const origLog = console.log;
		const origError = console.error;
		const origWarn = console.warn;
		function capture(prefix: string, args: any[]) {
			const msg = prefix + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
			consoleLogs = [...consoleLogs.slice(-50), msg];
		}
		console.log = (...args) => { origLog(...args); capture('', args); };
		console.error = (...args) => { origError(...args); capture('ERR: ', args); };
		console.warn = (...args) => { origWarn(...args); capture('WARN: ', args); };

		store.init();
		if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
		isPwa = window.matchMedia('(display-mode: standalone)').matches
			|| (navigator as any).standalone === true;
	});
</script>

<svelte:head>
	<title>ClipIt</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

<div class="app">
	<nav>
		<a href="/" class="logo">
			<span class="logo-icon">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<polygon points="23 7 16 12 23 17 23 7" />
					<rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
				</svg>
			</span>
			ClipIt
		</a>
		<div class="nav-links">
			<a href="/" class:active={currentPath === '/'}>Home</a>
			<a href="/levels" class:active={currentPath === '/levels'}>Levels</a>
			{#if state === 'ready'}
				<button class="nav-action-btn" onclick={handleExport} disabled={exporting} title="Export metadata as JSON">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
					</svg>
					{exporting ? 'Exporting...' : 'Export'}
				</button>
				<label class="nav-action-btn import-label" title="Import metadata JSON">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
					</svg>
					{importing ? 'Importing...' : 'Import'}
					<input type="file" accept=".json" onchange={handleImport} style="position:absolute;width:0;height:0;overflow:hidden;opacity:0" />
				</label>
				{#if isPwa}
					<button class="nav-action-btn" onclick={handleUpdate} disabled={updating} title="Check for updates and refresh">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
						</svg>
						{updating ? 'Updating...' : 'Update'}
					</button>
				{/if}
				<button class="nav-action-btn nuke-btn" onclick={handleNuke} title="Delete all data">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
					</svg>
					Nuke
				</button>
				{#if storageType === 'filesystem'}
					<button class="folder-btn" onclick={() => store.pickFolder()} title="Change storage folder">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
						</svg>
						{folderName ?? 'Folder'}
					</button>
				{:else}
					<span class="storage-badge" title="Data stored in browser (IndexedDB)">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
						</svg>
						Browser storage
					</span>
				{/if}
				<button class="nav-action-btn cdn-btn" class:cdn-active={store.getCdnBaseUrl()} onclick={() => { cdnBaseUrlInput = store.getCdnBaseUrl(); showCdnSettings = !showCdnSettings; }} title="Bunny CDN settings">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
						<path d="M12 12v9"/><path d="m8 17 4 4 4-4"/>
					</svg>
					CDN
				</button>
			{/if}
		</div>
	</nav>
	{#if showCdnSettings}
		<div class="cdn-settings-bar">
			<label class="cdn-label">Bunny CDN base URL</label>
			<input
				type="text"
				class="cdn-input"
				placeholder="https://yourzone.b-cdn.net"
				bind:value={cdnBaseUrlInput}
				onkeydown={(e) => { if (e.key === 'Enter') saveCdnBaseUrl(); if (e.key === 'Escape') showCdnSettings = false; }}
			/>
			<button class="cdn-save-btn" onclick={saveCdnBaseUrl}>Save</button>
			<button class="cdn-cancel-btn" onclick={() => showCdnSettings = false}>Cancel</button>
			<span class="cdn-hint">Videos stream from <code>{cdnBaseUrlInput || 'yourzone.b-cdn.net'}/{'{videoId}'}.mp4</code> when not available locally</span>
		</div>
	{/if}
	{#if exporting || importing}
		<div class="progress-bar-container">
			<div class="progress-bar" style="width: {progressPct}%"></div>
			<span class="progress-text">{progressMsg}</span>
		</div>
	{/if}
	<main>
		{#if state === 'loading'}
			<div class="gate">
				<div class="gate-spinner"></div>
			</div>
		{:else if state === 'no-folder' && storageType === 'filesystem'}
			<div class="gate">
				<div class="gate-icon">
					<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
					</svg>
				</div>
				<h2>Choose a folder</h2>
				<p>ClipIt stores your videos and clips as real files on your device. Pick a folder to get started.</p>
				<button class="gate-btn" onclick={() => store.pickFolder()}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
					</svg>
					Select Folder
				</button>
			</div>
		{:else if state === 'need-permission' && storageType === 'filesystem'}
			<div class="gate">
				<div class="gate-icon">
					<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
						<path d="M7 11V7a5 5 0 0 1 10 0v4" />
					</svg>
				</div>
				<h2>Permission needed</h2>
				<p>ClipIt needs access to your folder to read and save files. Click below to grant permission.</p>
				<button class="gate-btn" onclick={() => store.grantPermission()}>Grant Access</button>
				<button class="gate-btn-secondary" onclick={() => store.pickFolder()}>Choose Different Folder</button>
			</div>
		{:else}
			{@render children()}
		{/if}
	</main>

	<button class="console-toggle" onclick={() => showConsole = !showConsole}>
		{showConsole ? 'Hide' : 'Console'} ({consoleLogs.length})
	</button>

	{#if showConsole && consoleLogs.length > 0}
		<div class="console-panel">
			<div class="console-header">
				<span>Console</span>
				<button onclick={() => consoleLogs = []}>Clear</button>
			</div>
			<pre>{consoleLogs.join('\n')}</pre>
		</div>
	{/if}
</div>

<style>
	.console-toggle {
		position: fixed;
		bottom: 8px;
		right: 8px;
		background: rgba(24, 24, 27, 0.9);
		color: #52525b;
		border: 1px solid rgba(255, 255, 255, 0.08);
		padding: 4px 10px;
		border-radius: 6px;
		font-size: 10px;
		cursor: pointer;
		z-index: 9998;
		font-family: 'Inter', monospace;
	}

	.console-toggle:hover {
		color: #a1a1aa;
	}

	.console-panel {
		position: fixed;
		bottom: 36px;
		left: 0;
		right: 0;
		max-height: 40vh;
		background: rgba(9, 9, 11, 0.95);
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		z-index: 9998;
		overflow-y: auto;
		padding: 0;
	}

	.console-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 6px 12px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		font-size: 11px;
		color: #71717a;
		font-weight: 500;
		position: sticky;
		top: 0;
		background: rgba(9, 9, 11, 0.95);
	}

	.console-header button {
		background: none;
		border: none;
		color: #52525b;
		font-size: 10px;
		cursor: pointer;
	}

	.console-panel pre {
		margin: 0;
		padding: 8px 12px;
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 10px;
		line-height: 1.6;
		color: #a1a1aa;
		white-space: pre-wrap;
		word-break: break-all;
	}
	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		background: #09090b;
		color: #e4e4e7;
		font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
	}

	:global(::selection) {
		background: rgba(99, 102, 241, 0.3);
	}

	:global(::-webkit-scrollbar) {
		width: 6px;
	}

	:global(::-webkit-scrollbar-track) {
		background: transparent;
	}

	:global(::-webkit-scrollbar-thumb) {
		background: rgba(255, 255, 255, 0.1);
		border-radius: 3px;
	}

	:global(::-webkit-scrollbar-thumb:hover) {
		background: rgba(255, 255, 255, 0.2);
	}

	.app {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 24px;
		padding-top: env(safe-area-inset-top, 0);
		padding-left: max(env(safe-area-inset-left, 0), 24px);
		padding-right: max(env(safe-area-inset-right, 0), 24px);
		min-height: 56px;
		background: rgba(9, 9, 11, 0.95);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		position: sticky;
		top: 0;
		z-index: 50;
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 17px;
		font-weight: 700;
		color: #e4e4e7;
		text-decoration: none;
		letter-spacing: -0.02em;
	}

	.logo-icon {
		display: flex;
		color: #818cf8;
	}

	.nav-links {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		align-items: center;
	}

	.nav-links a {
		color: #71717a;
		text-decoration: none;
		font-size: 13px;
		font-weight: 500;
		padding: 6px 14px;
		border-radius: 6px;
		transition: color 0.15s, background 0.15s;
	}

	.nav-links a:hover {
		color: #e4e4e7;
		background: rgba(255, 255, 255, 0.05);
	}

	.nav-links a.active {
		color: #e4e4e7;
		background: rgba(255, 255, 255, 0.08);
	}

	.nav-action-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		color: #52525b;
		background: none;
		border: none;
		padding: 8px 10px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
		-webkit-tap-highlight-color: transparent;
		touch-action: manipulation;
		min-height: 44px;
	}

	.nav-action-btn:hover:not(:disabled) {
		color: #a1a1aa;
		background: rgba(255, 255, 255, 0.04);
	}

	.import-label {
		cursor: pointer;
		position: relative;
	}

	.nuke-btn:hover:not(:disabled) {
		color: #ef4444 !important;
		background: rgba(239, 68, 68, 0.08) !important;
	}

	.nav-action-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.folder-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		color: #52525b;
		background: none;
		border: 1px solid rgba(255, 255, 255, 0.06);
		padding: 5px 10px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
		margin-left: 8px;
	}

	.storage-badge {
		display: flex;
		align-items: center;
		gap: 5px;
		color: #3f3f46;
		font-size: 11px;
		font-weight: 500;
		padding: 5px 10px;
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 6px;
		margin-left: 8px;
	}

	.folder-btn:hover {
		color: #a1a1aa;
		border-color: rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.03);
	}

	.progress-bar-container {
		position: relative;
		height: 28px;
		background: #18181b;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}

	.progress-bar {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: rgba(99, 102, 241, 0.2);
		transition: width 0.3s ease;
	}

	.progress-text {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 11px;
		color: #818cf8;
		font-weight: 500;
	}

	main {
		flex: 1;
		max-width: 1280px;
		width: 100%;
		margin: 0 auto;
		padding: 28px 24px;
		padding-bottom: max(env(safe-area-inset-bottom, 0), 28px);
	}

	.gate {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 80px 24px;
		max-width: 420px;
		margin: 0 auto;
	}

	.gate-icon {
		color: #27272a;
		margin-bottom: 20px;
	}

	.gate h2 {
		font-size: 20px;
		font-weight: 600;
		margin: 0 0 8px;
		letter-spacing: -0.02em;
	}

	.gate p {
		color: #52525b;
		font-size: 14px;
		line-height: 1.6;
		margin: 0 0 24px;
	}

	.gate-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		background: #6366f1;
		color: #fff;
		border: none;
		padding: 12px 24px;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: background 0.15s;
	}

	.gate-btn:hover {
		background: #7c3aed;
	}

	.gate-btn-secondary {
		background: none;
		border: none;
		color: #52525b;
		font-size: 13px;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		margin-top: 12px;
		padding: 4px;
		transition: color 0.15s;
	}

	.gate-btn-secondary:hover {
		color: #a1a1aa;
	}

	.gate-spinner {
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

	@media (max-width: 640px) {
		nav {
			padding: 0 16px;
		}
		main {
			padding: 20px 16px;
		}
	}

	.cdn-btn {
		color: #52525b;
	}

	.cdn-btn.cdn-active {
		color: #34d399;
	}

	.cdn-settings-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 24px;
		background: #111113;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		flex-wrap: wrap;
	}

	.cdn-label {
		font-size: 12px;
		color: #71717a;
		font-weight: 500;
		white-space: nowrap;
	}

	.cdn-input {
		flex: 1;
		min-width: 240px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #e4e4e7;
		padding: 6px 10px;
		border-radius: 6px;
		font-size: 12px;
		font-family: 'Inter', sans-serif;
		outline: none;
	}

	.cdn-input:focus {
		border-color: rgba(52, 211, 153, 0.4);
	}

	.cdn-save-btn {
		background: rgba(52, 211, 153, 0.12);
		color: #34d399;
		border: 1px solid rgba(52, 211, 153, 0.2);
		padding: 6px 14px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
	}

	.cdn-cancel-btn {
		background: none;
		color: #52525b;
		border: none;
		padding: 6px 10px;
		border-radius: 6px;
		font-size: 12px;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
	}

	.cdn-hint {
		font-size: 11px;
		color: #3f3f46;
		width: 100%;
	}

	.cdn-hint code {
		color: #52525b;
		font-family: 'SF Mono', monospace;
	}
</style>
