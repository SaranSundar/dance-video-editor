<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import * as store from '$lib/store.svelte';

	let { children }: { children: Snippet } = $props();
	let currentPath = $derived($page.url.pathname);
	let state = $derived(store.getState());
	let folderName = $derived(store.getFolderName());
	let exporting = $state(false);
	let importing = $state(false);
	let importInput: HTMLInputElement | undefined = $state();

	async function handleExport() {
		exporting = true;
		try {
			const blob = await store.exportData();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `clipit-backup-${new Date().toISOString().slice(0, 10)}.zip`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			alert(`Export failed: ${e}`);
		} finally {
			exporting = false;
		}
	}

	async function handleImport(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (!confirm('This will replace all existing data. Continue?')) {
			input.value = '';
			return;
		}
		importing = true;
		try {
			await store.importData(file);
		} catch (err) {
			alert(`Import failed: ${err}`);
		} finally {
			importing = false;
			input.value = '';
		}
	}

	onMount(() => {
		store.init();
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
			{#if state === 'ready'}
				<button class="nav-action-btn" onclick={handleExport} disabled={exporting} title="Export backup">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
					</svg>
					{exporting ? 'Exporting...' : 'Export'}
				</button>
				<button class="nav-action-btn" onclick={() => importInput?.click()} disabled={importing} title="Import backup">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
					</svg>
					{importing ? 'Importing...' : 'Import'}
				</button>
				<input bind:this={importInput} type="file" accept=".zip" onchange={handleImport} style="display:none" />
				<button class="folder-btn" onclick={() => store.pickFolder()} title="Change storage folder">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
					</svg>
					{folderName ?? 'Folder'}
				</button>
			{/if}
		</div>
	</nav>
	<main>
		{#if state === 'loading'}
			<div class="gate">
				<div class="gate-spinner"></div>
			</div>
		{:else if state === 'no-folder'}
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
		{:else if state === 'need-permission'}
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
</div>

<style>
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
		height: 56px;
		background: rgba(9, 9, 11, 0.8);
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
		padding: 5px 8px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		font-family: 'Inter', sans-serif;
		transition: all 0.15s;
	}

	.nav-action-btn:hover:not(:disabled) {
		color: #a1a1aa;
		background: rgba(255, 255, 255, 0.04);
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

	.folder-btn:hover {
		color: #a1a1aa;
		border-color: rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.03);
	}

	main {
		flex: 1;
		max-width: 1280px;
		width: 100%;
		margin: 0 auto;
		padding: 28px 24px;
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
</style>
