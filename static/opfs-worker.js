// Web Worker for writing large files to OPFS
// Uses createSyncAccessHandle to stream data in chunks without loading entire file into memory

self.addEventListener('message', async (e) => {
	const { action, path, file, dirPath } = e.data;

	try {
		if (action === 'write') {
			await writeFileChunked(dirPath, path, file);
			self.postMessage({ action: 'done' });
		} else if (action === 'delete') {
			await deleteFile(dirPath, path);
			self.postMessage({ action: 'done' });
		}
	} catch (err) {
		self.postMessage({ action: 'error', error: err.message || String(err) });
	}
});

async function getDir(dirPath) {
	let dir = await navigator.storage.getDirectory();
	if (dirPath) {
		for (const part of dirPath.split('/').filter(Boolean)) {
			dir = await dir.getDirectoryHandle(part, { create: true });
		}
	}
	return dir;
}

async function writeFileChunked(dirPath, fileName, file) {
	const dir = await getDir(dirPath);
	const fileHandle = await dir.getFileHandle(fileName, { create: true });
	const accessHandle = await fileHandle.createSyncAccessHandle();

	const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
	const totalSize = file.size;
	let offset = 0;

	accessHandle.truncate(0);

	while (offset < totalSize) {
		const end = Math.min(offset + CHUNK_SIZE, totalSize);
		const chunk = file.slice(offset, end);
		const buffer = await chunk.arrayBuffer();
		accessHandle.write(new Uint8Array(buffer), { at: offset });
		offset = end;

		// Report progress
		const pct = Math.round((offset / totalSize) * 100);
		self.postMessage({ action: 'progress', pct });
	}

	accessHandle.flush();
	accessHandle.close();
}

async function deleteFile(dirPath, fileName) {
	const dir = await getDir(dirPath);
	await dir.removeEntry(fileName);
}
