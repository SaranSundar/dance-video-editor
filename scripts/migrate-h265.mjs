/**
 * Migration script: upload H.265 videos to Bunny Storage, remap clips.
 *
 * 1. Fetches current metadata from Bunny CDN (preserves clips)
 * 2. Uploads all H.265 videos with new UUIDs
 * 3. Matches old videos to new by name similarity
 * 4. Remaps clip videoIds to the new video IDs
 * 5. Saves updated metadata to Bunny Storage
 */

import { createReadStream } from 'fs';
import { readdir, stat, open } from 'fs/promises';
import { join } from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { Readable } from 'stream';

const STORAGE_ZONE = 'dance-videos-ss';
const API_KEY = 'e23def33-c1e6-4b94-b7ffa764825a-b295-44be';
const STORAGE_HOST = 'la.storage.bunnycdn.com';
const CDN_BASE = 'https://dance-videos.b-cdn.net';
const DIR = process.argv[2] || '/Users/saran/Downloads/bachata-playlist/h265';

const couples = [
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

function stripAccents(s) {
	return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function normalize(s) {
	return stripAccents(s)
		.toLowerCase()
		.replace(/[_\-\.@｜|&＊\[\]()🗽💃🎵📍🧡💚👀]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function detectDancers(filename) {
	const name = normalize(filename);
	for (const [lead, follow] of couples) {
		const l = stripAccents(lead.toLowerCase());
		const f = stripAccents(follow.toLowerCase());
		if (name.includes(l) && name.includes(f)) return { lead, follow };
	}
	for (const [lead, follow] of couples) {
		const l = stripAccents(lead.toLowerCase());
		const f = stripAccents(follow.toLowerCase());
		if (name.includes(l) || name.includes(f)) return { lead, follow };
	}
	if (name.includes('favian')) return { lead: 'Favian', follow: '' };
	return { lead: '', follow: '' };
}

function detectDance(filename) {
	return filename.toLowerCase().includes('salsa') ? 'salsa' : 'bachata';
}

// Extract key words from a video name for matching
function extractKeywords(name) {
	return new Set(
		normalize(name)
			.replace(/^\d+\s*-?\s*/, '') // strip leading number
			.split(/\s+/)
			.filter(w => w.length > 2)
	);
}

// Score how well two names match (higher = better)
function matchScore(nameA, nameB) {
	const kwA = extractKeywords(nameA);
	const kwB = extractKeywords(nameB);
	let matches = 0;
	for (const w of kwA) {
		if (kwB.has(w)) matches++;
	}
	// Normalize by the smaller set size
	const minSize = Math.min(kwA.size, kwB.size);
	return minSize > 0 ? matches / minSize : 0;
}

function getDuration(filePath) {
	try {
		const out = execSync(
			`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
			{ stdio: ['pipe', 'pipe', 'pipe'] }
		).toString().trim();
		return parseFloat(out) || 0;
	} catch {
		return 0;
	}
}

async function computeFingerprint(filePath, fileSize) {
	const chunkSize = Math.min(fileSize, 1024 * 1024);
	const buf = Buffer.alloc(chunkSize);
	const fh = await open(filePath, 'r');
	await fh.read(buf, 0, chunkSize, 0);
	await fh.close();
	const hash = crypto.createHash('sha256').update(buf).digest('hex');
	return `${fileSize}:${hash}`;
}

async function uploadFile(filePath, remoteName, fileSize) {
	const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${remoteName}`;
	const nodeStream = createReadStream(filePath);
	const webStream = Readable.toWeb(nodeStream);

	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			'AccessKey': API_KEY,
			'Content-Type': 'video/mp4',
			'Content-Length': String(fileSize),
		},
		body: webStream,
		duplex: 'half',
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`HTTP ${response.status}: ${text}`);
	}
}

async function saveMetadata(meta) {
	const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/metadata.json`;
	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			'AccessKey': API_KEY,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(meta, null, 2),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Save metadata failed: HTTP ${response.status}: ${text}`);
	}
}

async function fetchMetadata() {
	const res = await fetch(`${CDN_BASE}/metadata.json`, { cache: 'no-store' });
	if (!res.ok) return { videos: [], clips: [], practices: [] };
	return res.json();
}

async function main() {
	console.log('=== H.265 Migration ===\n');

	// 1. Fetch current metadata
	console.log('Fetching current metadata from Bunny...');
	const currentMeta = await fetchMetadata();
	console.log(`  Found ${currentMeta.videos.length} existing videos, ${currentMeta.clips?.length ?? 0} clips, ${currentMeta.practices?.length ?? 0} practices\n`);

	// 2. Read local H.265 files
	const entries = await readdir(DIR);
	const mp4Files = entries.filter(f => f.toLowerCase().endsWith('.mp4')).sort();
	console.log(`Found ${mp4Files.length} H.265 files in ${DIR}\n`);

	// 3. Upload each file and build new video entries
	const newVideos = [];
	const oldToNewMap = new Map(); // old video ID → new video ID

	for (let i = 0; i < mp4Files.length; i++) {
		const filename = mp4Files[i];
		const filePath = join(DIR, filename);
		const info = await stat(filePath);
		const fileSize = info.size;
		const id = crypto.randomUUID();
		const remoteName = `${id}.mp4`;
		const displayName = filename.replace(/\.mp4$/i, '');

		console.log(`[${i + 1}/${mp4Files.length}] ${displayName}`);
		console.log(`  Size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

		// Match to existing video
		let bestMatch = null;
		let bestScore = 0;
		for (const oldVideo of currentMeta.videos) {
			const score = matchScore(displayName, oldVideo.name);
			if (score > bestScore && score >= 0.4) {
				bestScore = score;
				bestMatch = oldVideo;
			}
		}

		if (bestMatch) {
			console.log(`  Matched: "${bestMatch.name}" (score: ${bestScore.toFixed(2)})`);
			oldToNewMap.set(bestMatch.id, id);
		} else {
			console.log(`  No match (new video)`);
		}

		const { lead, follow } = detectDancers(filename);
		const dance = detectDance(filename);
		const duration = getDuration(filePath);
		const fingerprint = await computeFingerprint(filePath, fileSize);

		console.log(`  Dancers: ${lead || '?'} & ${follow || '?'} | Duration: ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`);
		console.log(`  Uploading...`);

		try {
			await uploadFile(filePath, remoteName, fileSize);
			console.log(`  Uploaded as ${remoteName}`);
		} catch (err) {
			console.error(`  UPLOAD FAILED: ${err.message}`);
			continue;
		}

		newVideos.push({
			id,
			name: displayName,
			fingerprint,
			duration,
			lead,
			follow,
			dance,
			hidden: false,
			hiddenFromSearch: false,
			addedAt: new Date().toISOString(),
			cdnUrl: `${CDN_BASE}/${remoteName}`,
		});

		console.log('');
	}

	// 4. Remap clips
	const oldClips = currentMeta.clips ?? [];
	let remapped = 0;
	let orphaned = 0;

	const newClips = oldClips.map(clip => {
		const newVideoId = oldToNewMap.get(clip.videoId);
		if (newVideoId) {
			const newVideo = newVideos.find(v => v.id === newVideoId);
			remapped++;
			return {
				...clip,
				videoId: newVideoId,
				videoName: newVideo?.name ?? clip.videoName,
			};
		}
		orphaned++;
		return clip; // keep as-is (orphaned)
	});

	console.log(`\n=== Clip Remapping ===`);
	console.log(`  ${remapped} clips remapped to new videos`);
	console.log(`  ${orphaned} clips orphaned (old video not matched)`);

	// Show mapping
	console.log(`\n=== Video Mapping ===`);
	for (const [oldId, newId] of oldToNewMap) {
		const oldVideo = currentMeta.videos.find(v => v.id === oldId);
		const newVideo = newVideos.find(v => v.id === newId);
		console.log(`  "${oldVideo?.name}" → "${newVideo?.name}"`);
	}

	// 5. Build new metadata
	const newMeta = {
		videos: newVideos,
		clips: newClips.filter(c => {
			// Only keep clips whose videoId exists in newVideos
			return newVideos.some(v => v.id === c.videoId);
		}),
		practices: currentMeta.practices ?? [],
	};

	const droppedClips = newClips.length - newMeta.clips.length;
	if (droppedClips > 0) {
		console.log(`\n  ${droppedClips} orphaned clips dropped (video no longer exists)`);
	}

	// 6. Confirm and save
	console.log(`\n=== Summary ===`);
	console.log(`  New videos: ${newMeta.videos.length}`);
	console.log(`  Preserved clips: ${newMeta.clips.length}`);
	console.log(`  Practices: ${newMeta.practices.length}`);

	console.log(`\nSaving metadata to Bunny...`);
	await saveMetadata(newMeta);
	console.log(`Done! Metadata saved to Bunny Storage.`);
}

main().catch(console.error);
