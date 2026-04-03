/**
 * Upload videos from bachata-demos to Bunny Storage
 * Generates UUIDs, computes fingerprints, detects dancer metadata,
 * and outputs a metadata JSON ready to import into ClipIt.
 */

import { createReadStream, createWriteStream } from 'fs';
import { readdir, stat, open } from 'fs/promises';
import { join, basename } from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { Readable } from 'stream';

const STORAGE_ZONE = 'dance-videos-ss';
const API_KEY = 'e23def33-c1e6-4b94-b7ffa764825a-b295-44be';
const STORAGE_HOST = 'la.storage.bunnycdn.com';
const CDN_BASE = 'https://dance-videos-ss.b-cdn.net';
const DIR = '/Users/saran/Downloads/bachata-demos';
const OUT = '/Users/saran/Downloads/clipit-bunny-metadata.json';

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

function detectDancers(filename) {
  const name = stripAccents(filename.toLowerCase().replace(/[_\-\.]/g, ' '));
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

async function computeFingerprint(filePath, fileSize) {
  const chunkSize = Math.min(fileSize, 1024 * 1024);
  const buf = Buffer.alloc(chunkSize);
  const fh = await open(filePath, 'r');
  await fh.read(buf, 0, chunkSize, 0);
  await fh.close();
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  return `${fileSize}:${hash}`;
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

async function main() {
  const entries = await readdir(DIR);
  const mp4Files = entries
    .filter(f => f.toLowerCase().endsWith('.mp4'))
    .sort();

  console.log(`Found ${mp4Files.length} MP4 files\n`);

  const videos = [];

  for (const filename of mp4Files) {
    const filePath = join(DIR, filename);
    const info = await stat(filePath);
    const fileSize = info.size;
    const id = crypto.randomUUID();
    const remoteName = `${id}.mp4`;

    console.log(`[${mp4Files.indexOf(filename) + 1}/${mp4Files.length}] ${filename}`);
    console.log(`  ID: ${id}`);
    console.log(`  Size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

    const fingerprint = await computeFingerprint(filePath, fileSize);
    console.log(`  Fingerprint: ${fingerprint.slice(0, 40)}...`);

    const duration = getDuration(filePath);
    console.log(`  Duration: ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`);

    const { lead, follow } = detectDancers(filename);
    const dance = detectDance(filename);
    console.log(`  Dancers: ${lead || '?'} & ${follow || '?'} (${dance})`);

    console.log(`  Uploading...`);
    try {
      await uploadFile(filePath, remoteName, fileSize);
      console.log(`  ✓ Uploaded as ${remoteName}`);
    } catch (err) {
      console.error(`  ✗ Upload failed: ${err.message}`);
      continue;
    }

    videos.push({
      id,
      name: filename.replace(/\.mp4$/i, ''),
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

  const metadata = { videos, clips: [] };
  const { writeFile } = await import('fs/promises');
  await writeFile(OUT, JSON.stringify(metadata, null, 2));

  console.log(`\n✓ Done! Uploaded ${videos.length}/${mp4Files.length} videos`);
  console.log(`✓ Metadata saved to: ${OUT}`);
  console.log(`\nNext steps:`);
  console.log(`  1. In the app nav, click CDN and set: ${CDN_BASE}`);
  console.log(`  2. Import the metadata file: ${OUT}`);
}

main().catch(console.error);
