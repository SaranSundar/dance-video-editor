const SUPPORTED_VIDEO_CODECS = new Set(['avc1', 'avc3', 'hvc1', 'hev1']);
const KNOWN_UNSUPPORTED = new Map([
	['vp08', 'VP8'], ['vp09', 'VP9'], ['av01', 'AV1'],
]);

/**
 * Detect the video codec from an MP4 file by finding the stsd box inside moov.
 * Returns the 4-char codec identifier (e.g. 'avc1', 'hvc1', 'vp09') or null.
 */
export async function getMp4VideoCodec(file: Blob): Promise<string | null> {
	try {
		const moov = await findAtom(file, 'moov', 0, file.size);
		if (!moov) return null;
		const moovEnd = moov.offset + moov.size;

		// Walk: moov -> trak -> mdia -> minf -> stbl -> stsd
		const trak = await findAtom(file, 'trak', moov.offset + 8, moovEnd);
		if (!trak) return null;
		const mdia = await findAtom(file, 'mdia', trak.offset + 8, trak.offset + trak.size);
		if (!mdia) return null;
		const minf = await findAtom(file, 'minf', mdia.offset + 8, mdia.offset + mdia.size);
		if (!minf) return null;
		const stbl = await findAtom(file, 'stbl', minf.offset + 8, minf.offset + minf.size);
		if (!stbl) return null;
		const stsd = await findAtom(file, 'stsd', stbl.offset + 8, stbl.offset + stbl.size);
		if (!stsd) return null;

		// stsd: 8 (header) + 1 (version) + 3 (flags) + 4 (entry count) + 4 (entry size) + 4 (codec)
		const buf = await file.slice(stsd.offset + 20, stsd.offset + 24).arrayBuffer();
		if (buf.byteLength < 4) return null;
		const v = new DataView(buf);
		return String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
	} catch {
		return null;
	}
}

/**
 * Check if an MP4 file uses a universally supported video codec (H.264 or H.265).
 * Returns { supported: true } or { supported: false, codec: string }.
 */
export async function checkVideoCodec(file: Blob): Promise<{ supported: boolean; codec: string }> {
	const codec = await getMp4VideoCodec(file);
	if (!codec) return { supported: true, codec: 'unknown' }; // can't detect, allow through
	if (SUPPORTED_VIDEO_CODECS.has(codec)) return { supported: true, codec };
	const name = KNOWN_UNSUPPORTED.get(codec) || codec;
	return { supported: false, codec: name };
}

/**
 * Read MP4 duration directly from file bytes by parsing the moov/mvhd atoms.
 * Uses only blob.slice() - no video element, no memory issues.
 * Returns duration in seconds, or 0 if parsing fails.
 */
export async function getMp4Duration(file: Blob, log?: (msg: string) => void): Promise<number> {
	try {
		log?.(`[mp4] File size: ${file.size}, type: ${file.type}`);

		// Verify we can read the file
		const testSlice = await file.slice(0, 8).arrayBuffer();
		if (testSlice.byteLength < 8) {
			log?.(`[mp4] Can't read file, got ${testSlice.byteLength} bytes`);
			return 0;
		}

		// List top-level atoms for debugging
		await listAtoms(file, 0, Math.min(file.size, 500 * 1024 * 1024), log);

		// MP4 files are structured as a series of "atoms" (boxes)
		// We need to find: moov -> mvhd which contains timescale and duration
		const moovData = await findAtom(file, 'moov', 0, file.size);
		if (!moovData) {
			log?.('[mp4] moov atom not found');
			return 0;
		}
		log?.(`[mp4] Found moov at offset ${moovData.offset}, size ${moovData.size}`);

		const mvhdData = await findAtom(file, 'mvhd', moovData.offset + 8, moovData.offset + moovData.size);
		if (!mvhdData) {
			log?.('[mp4] mvhd atom not found inside moov');
			return 0;
		}
		log?.(`[mp4] Found mvhd at offset ${mvhdData.offset}, size ${mvhdData.size}`);

		// Read mvhd atom content
		const mvhdContent = await file.slice(mvhdData.offset, mvhdData.offset + mvhdData.size).arrayBuffer();
		const view = new DataView(mvhdContent);

		// Skip 8 bytes (size + type), then read version
		const version = view.getUint8(8);

		let timescale: number;
		let duration: number;

		if (version === 0) {
			// Version 0: 4-byte fields
			// offset 8: version(1) + flags(3) + creation_time(4) + modification_time(4) = 20
			timescale = view.getUint32(20);
			duration = view.getUint32(24);
		} else {
			// Version 1: 8-byte fields
			// offset 8: version(1) + flags(3) + creation_time(8) + modification_time(8) = 28
			timescale = view.getUint32(28);
			// Duration is 8 bytes but we only need the low 32 bits for practical durations
			const durationHigh = view.getUint32(32);
			const durationLow = view.getUint32(36);
			duration = durationHigh * 4294967296 + durationLow;
		}

		log?.(`[mp4] version=${version}, timescale=${timescale}, duration=${duration}`);
		if (timescale === 0) return 0;
		const seconds = duration / timescale;
		log?.(`[mp4] Duration: ${seconds.toFixed(2)}s`);
		return seconds;
	} catch {
		return 0;
	}
}

async function listAtoms(file: Blob, start: number, end: number, log?: (msg: string) => void): Promise<void> {
	let offset = start;
	let count = 0;
	while (offset < end && count < 20) {
		const headerBuf = await file.slice(offset, offset + 8).arrayBuffer();
		if (headerBuf.byteLength < 8) break;
		const view = new DataView(headerBuf);
		let size = view.getUint32(0);
		const type = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));
		if (size === 1) {
			const extBuf = await file.slice(offset + 8, offset + 16).arrayBuffer();
			size = Number(new DataView(extBuf).getBigUint64(0));
		} else if (size === 0) {
			size = end - offset;
		}
		log?.(`[mp4] Atom: "${type}" at ${offset}, size ${size}`);
		if (size < 8) break;
		offset += size;
		count++;
	}
}

async function findAtom(
	file: Blob,
	targetType: string,
	start: number,
	end: number
): Promise<{ offset: number; size: number } | null> {
	let offset = start;
	const target = targetType.split('').map(c => c.charCodeAt(0));

	while (offset < end) {
		// Read atom header (8 bytes: 4 size + 4 type)
		const headerBuf = await file.slice(offset, offset + 8).arrayBuffer();
		if (headerBuf.byteLength < 8) return null;

		const view = new DataView(headerBuf);
		let size = view.getUint32(0);
		const type = [view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7)];

		// Handle extended size
		if (size === 1) {
			const extBuf = await file.slice(offset + 8, offset + 16).arrayBuffer();
			const extView = new DataView(extBuf);
			size = Number(extView.getBigUint64(0));
		} else if (size === 0) {
			size = end - offset;
		}

		if (size < 8) return null;

		// Check if this is the target atom
		if (type[0] === target[0] && type[1] === target[1] && type[2] === target[2] && type[3] === target[3]) {
			return { offset, size };
		}

		offset += size;
	}

	return null;
}
