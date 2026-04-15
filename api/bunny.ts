import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORAGE_ZONE = 'dance-videos-ss';
const API_KEY = 'e23def33-c1e6-4b94-b7ffa764825a-b295-44be';
const STORAGE_HOST = 'la.storage.bunnycdn.com';

export const config = {
	maxDuration: 300,
	api: {
		bodyParser: {
			sizeLimit: '700mb',
		},
	},
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
	if (req.method !== 'PUT') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const filePath = req.query.path;
	if (!filePath || typeof filePath !== 'string') {
		return res.status(400).json({ error: 'Missing path query param' });
	}

	const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${filePath}`;
	const contentType = req.headers['content-type'] || 'application/octet-stream';

	// Collect request body as buffer
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}
	const body = Buffer.concat(chunks);

	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			'AccessKey': API_KEY,
			'Content-Type': contentType,
		},
		body,
	});

	if (!response.ok) {
		const text = await response.text();
		return res.status(response.status).json({ error: text });
	}

	return res.status(200).json({ ok: true });
}
