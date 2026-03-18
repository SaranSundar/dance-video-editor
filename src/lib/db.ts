import Dexie, { type EntityTable } from 'dexie';

export interface Video {
	id?: number;
	name: string;
	blob: Blob;
	duration: number;
	addedAt: Date;
}

export interface Clip {
	id?: number;
	videoId: number;
	videoName: string;
	label: string;
	startTime: number;
	endTime: number;
	tags: string[];
	notes: string;
	blob: Blob | null;
	thumbnailBlob: Blob | null;
	createdAt: Date;
}

const db = new Dexie('VideoClipEditor') as Dexie & {
	videos: EntityTable<Video, 'id'>;
	clips: EntityTable<Clip, 'id'>;
};

db.version(1).stores({
	videos: '++id, name, addedAt',
	clips: '++id, videoId, label, *tags, createdAt'
});

export { db };
