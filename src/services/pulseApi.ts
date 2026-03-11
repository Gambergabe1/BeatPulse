import { upload } from '@vercel/blob/client';

export interface ScoreRecord {
  score: number;
  accuracy: number;
  date: string;
  username: string;
}

export interface CommunitySongRecord {
  id: string;
  name: string;
  artist: string;
  audioUrl: string;
  audioPath: string;
  notesUrl: string;
  notesPath: string;
  difficulty: number;
  density?: number;
  laneVariety?: number;
  sliderProbability?: number;
  stamina?: number;
  topScore: number;
  scores?: ScoreRecord[];
  authorName?: string;
  createdAt: string;
  status?: string;
}

export interface ReplayRecord {
  id: string;
  songId: string;
  songName: string;
  artist: string;
  difficulty: number;
  density?: number;
  laneVariety?: number;
  sliderProbability?: number;
  stamina?: number;
  score: number;
  accuracy: number;
  date: string;
  createdAt: string;
  events: any[];
}

export interface SongStorageIssue {
  id: string;
  name: string;
  artist: string;
  missingAudio: boolean;
  missingNotes: boolean;
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

function createSongId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `song-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeFileName(input: string): string {
  return input.replace(/[^\w.-]/g, '_').replace(/_+/g, '_').slice(0, 120) || 'upload';
}

function getFileExtension(fileName: string): string {
  const match = /\.[^./\\]+$/.exec(fileName);
  return match ? match[0] : '.mp3';
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  const payload = (await res.json().catch(() => ({}))) as ApiResponse<T>;

  if (!res.ok || payload.success === false) {
    const message = payload.success === false ? payload.error : `Request failed (${res.status})`;
    throw new Error(message || 'Request failed');
  }

  return payload.data;
}

export const getCommunitySongs = async (): Promise<CommunitySongRecord[]> => {
  return parseApiResponse<CommunitySongRecord[]>(await fetch('/api/songs'));
};

export const getSongById = async (id: string): Promise<CommunitySongRecord> => {
  return parseApiResponse<CommunitySongRecord>(await fetch(`/api/songs/${encodeURIComponent(id)}`));
};

export const saveCommunitySong = async (payload: {
  audioFile: File;
  name: string;
  artist: string;
  difficulty: number;
  density: number;
  laneVariety: number;
  sliderProbability: number;
  stamina: number;
  authorName: string;
  notes: unknown[];
}): Promise<CommunitySongRecord> => {
  const songId = createSongId();
  const fileExtension = getFileExtension(payload.audioFile.name);
  const baseName = sanitizeFileName(payload.audioFile.name.replace(/\.[^./\\]+$/, ''));
  const audioPath = `songs/${songId}/${baseName}${fileExtension || '.mp3'}`;
  const notesPath = `songs/${songId}/notes.json`;

  const [audioBlob, notesBlob] = await Promise.all([
    upload(audioPath, payload.audioFile, {
      access: 'public',
      contentType: payload.audioFile.type || 'audio/mpeg',
      handleUploadUrl: '/api/blob-upload',
      clientPayload: JSON.stringify({ songId, kind: 'audio' }),
      multipart: true,
    }),
    upload(
      notesPath,
      new Blob([JSON.stringify(payload.notes)], { type: 'application/json' }),
      {
        access: 'public',
        contentType: 'application/json',
        handleUploadUrl: '/api/blob-upload',
        clientPayload: JSON.stringify({ songId, kind: 'notes' }),
      }
    ),
  ]);

  const res = await fetch('/api/songs/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: songId,
      name: payload.name,
      artist: payload.artist,
      difficulty: payload.difficulty,
      density: payload.density,
      laneVariety: payload.laneVariety,
      sliderProbability: payload.sliderProbability,
      stamina: payload.stamina,
      authorName: payload.authorName,
      audioUrl: audioBlob.url,
      audioPath,
      notesUrl: notesBlob.url,
      notesPath,
    }),
  });
  return parseApiResponse<CommunitySongRecord>(res);
};

export const updateCommunitySong = async (
  id: string,
  updates: Record<string, unknown>,
  token: string | null
): Promise<CommunitySongRecord> => {
  const res = await fetch(`/api/songs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(updates),
  });
  return parseApiResponse<CommunitySongRecord>(res);
};

export const deleteCommunitySong = async (id: string, token: string | null): Promise<void> => {
  const res = await fetch(`/api/songs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  await parseApiResponse<Record<string, string>>(res);
};

export const postSongScore = async (
  id: string,
  score: number,
  accuracy: number,
  username: string
): Promise<CommunitySongRecord> => {
  const res = await fetch(`/api/songs/${encodeURIComponent(id)}/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ score, accuracy, username }),
  });
  return parseApiResponse<CommunitySongRecord>(res);
};

export const getGlobalScores = async (options?: { limit?: number; offset?: number }): Promise<{
  scores: any[];
  nextOffset: number | null;
}> => {
  const search = new URLSearchParams();
  if (options?.limit) search.set('limit', String(options.limit));
  if (options?.offset !== undefined) search.set('offset', String(options.offset));

  const res = await fetch(`/api/global-scores${search.toString() ? `?${search}` : ''}`);
  return parseApiResponse<{ scores: any[]; nextOffset: number | null }>(res);
};

export const saveGlobalScore = async (payload: {
  score: number;
  accuracy: number;
  date: string;
  username: string;
  songName: string;
  artist: string;
}): Promise<void> => {
  const res = await fetch('/api/global-scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await parseApiResponse<{ id: string }>(res);
};

export const getReplays = async (): Promise<ReplayRecord[]> => {
  return parseApiResponse<ReplayRecord[]>(await fetch('/api/replays'));
};

export const saveReplay = async (payload: Omit<ReplayRecord, 'id'>): Promise<ReplayRecord> => {
  const res = await fetch('/api/replays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseApiResponse<ReplayRecord>(res);
};

export const loginAdmin = async (password: string): Promise<string> => {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await parseApiResponse<{ token: string }>(res);
  return data.token;
};

export const changeAdminPassword = async (token: string, newPassword: string): Promise<void> => {
  const res = await fetch('/api/admin/password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ newPassword }),
  });
  await parseApiResponse<{ successMessage: string }>(res);
};

export const getIntegrityReport = async (): Promise<{
  songsCount: number;
  scoresCount: number;
  replaysCount: number;
  missingAssetSongsCount: number;
  missingAssetSongs: SongStorageIssue[];
}> => {
  return parseApiResponse<{
    songsCount: number;
    scoresCount: number;
    replaysCount: number;
    missingAssetSongsCount: number;
    missingAssetSongs: SongStorageIssue[];
  }>(await fetch('/api/integrity'));
};
