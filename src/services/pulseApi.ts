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

export interface GlobalScoreRecord {
  id: string;
  songId?: string;
  score: number;
  accuracy: number;
  date: string;
  username: string;
  createdAt: string;
  songName: string;
  artist: string;
}

export interface LeaderboardModerationResult {
  username: string;
  reason: string;
  removedGlobalScores: number;
  removedSongScores: number;
  affectedSongs: number;
}

export interface SongStorageIssue {
  id: string;
  name: string;
  artist: string;
  missingAudio: boolean;
  missingNotes: boolean;
}

export interface ReplayLinkIssue {
  id: string;
  songId: string;
  songName: string;
  artist: string;
  issue: 'missing-song' | 'metadata-mismatch';
  expectedSongId?: string;
  expectedSongName?: string;
  expectedArtist?: string;
}

export interface GlobalScoreLinkIssue {
  id: string;
  songId?: string;
  songName: string;
  artist: string;
  issue: 'missing-song' | 'missing-song-link' | 'metadata-mismatch';
  expectedSongId?: string;
  expectedSongName?: string;
  expectedArtist?: string;
}

export interface DataRelationshipMaintenance {
  linkedGlobalScores: number;
  updatedGlobalScoreMetadata: number;
  linkedReplays: number;
  updatedReplayMetadata: number;
  removedOrphanReplays: number;
  unresolvedGlobalScores: number;
  unresolvedReplays: number;
}

export interface ForcedStorageUpdateResult {
  schemaVersion: number;
  checkedCollections: string[];
  normalizedRows: {
    songs: number;
    globalScores: number;
    replays: number;
  };
  songsCount: number;
  globalScoresCount: number;
  replaysCount: number;
  rewrittenCollections?: string[];
  backups?: string[];
  relationshipActions?: DataRelationshipMaintenance;
}

export interface IntegrityReport {
  songsCount: number;
  scoresCount: number;
  replaysCount: number;
  missingAssetSongsCount: number;
  missingAssetSongs: SongStorageIssue[];
  replayLinkIssuesCount: number;
  replayLinkIssues: ReplayLinkIssue[];
  globalScoreLinkIssuesCount: number;
  globalScoreLinkIssues: GlobalScoreLinkIssue[];
  configurationIssues: string[];
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

const DIRECT_UPLOAD_ENDPOINT = '/api/blob/upload';
const MULTIPART_UPLOAD_THRESHOLD_BYTES = 8 * 1024 * 1024;

function getFallbackErrorMessage(rawText: string, status: number) {
  const trimmed = rawText.trim();
  if (!trimmed) return `Request failed (${status})`;
  if (trimmed.startsWith('<')) return `Request failed (${status})`;
  return trimmed.slice(0, 240);
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  const rawText = await res.text();
  let parsedPayload = {} as ApiResponse<T>;
  if (rawText) {
    try {
      parsedPayload = JSON.parse(rawText) as ApiResponse<T>;
    } catch {
      parsedPayload = {} as ApiResponse<T>;
    }
  }

  if (!rawText) {
    throw new Error(res.ok ? 'Empty API response' : `Request failed (${res.status})`);
  }

  if (!res.ok || parsedPayload.success !== true) {
    const message =
      parsedPayload.success === false
        ? parsedPayload.error
        : getFallbackErrorMessage(rawText, res.status);
    throw new Error(message || 'Request failed');
  }

  return parsedPayload.data;
}

function sanitizeUploadFileName(input: string) {
  return input.replace(/[^\w.-]/g, '_').replace(/_+/g, '_').slice(0, 120) || 'upload';
}

function isLocalHostname() {
  if (typeof window === 'undefined') return true;
  const hostname = window.location.hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function getAudioExtension(file: File) {
  return file.name.match(/\.[0-9a-z]{1,8}$/i)?.[0] || '.mp3';
}

async function uploadSongAssetsDirectly(payload: {
  id: string;
  audioFile: File;
  notes: unknown[];
}) {
  try {
    const audioExtension = getAudioExtension(payload.audioFile);
    const audioBaseName = payload.audioFile.name
      ? sanitizeUploadFileName(payload.audioFile.name.replace(audioExtension, ''))
      : 'audio';
    const audioPath = `songs/${payload.id}/${audioBaseName}${audioExtension}`;
    const notesPath = `songs/${payload.id}/notes.json`;
    const notesBlob = new Blob([JSON.stringify(payload.notes)], { type: 'application/json' });

    const [audioUpload, notesUpload] = await Promise.all([
      upload(audioPath, payload.audioFile, {
        access: 'public',
        handleUploadUrl: DIRECT_UPLOAD_ENDPOINT,
        contentType: payload.audioFile.type || undefined,
        multipart: payload.audioFile.size >= MULTIPART_UPLOAD_THRESHOLD_BYTES,
      }),
      upload(notesPath, notesBlob, {
        access: 'public',
        handleUploadUrl: DIRECT_UPLOAD_ENDPOINT,
        contentType: 'application/json',
      }),
    ]);

    return {
      audioUrl: audioUpload.url,
      audioPath: audioUpload.pathname,
      notesUrl: notesUpload.url,
      notesPath: notesUpload.pathname,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Direct upload failed.';
    throw new Error(message === 'Failed to  retrieve the client token'
      ? 'Direct upload is unavailable on this deployment.'
      : message);
  }
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
  if (!isLocalHostname()) {
    const id = crypto.randomUUID();
    const uploadedAssets = await uploadSongAssetsDirectly({
      id,
      audioFile: payload.audioFile,
      notes: payload.notes,
    });

    const res = await fetch('/api/songs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name: payload.name,
        artist: payload.artist,
        difficulty: payload.difficulty,
        density: payload.density,
        laneVariety: payload.laneVariety,
        sliderProbability: payload.sliderProbability,
        stamina: payload.stamina,
        authorName: payload.authorName,
        ...uploadedAssets,
      }),
    });

    return parseApiResponse<CommunitySongRecord>(res);
  }

  const formData = new FormData();
  formData.append('audio', payload.audioFile);
  formData.append('name', payload.name);
  formData.append('artist', payload.artist);
  formData.append('difficulty', String(payload.difficulty));
  formData.append('density', String(payload.density));
  formData.append('laneVariety', String(payload.laneVariety));
  formData.append('sliderProbability', String(payload.sliderProbability));
  formData.append('stamina', String(payload.stamina));
  formData.append('authorName', payload.authorName);
  formData.append('notes', JSON.stringify(payload.notes));

  const res = await fetch('/api/songs', {
    method: 'POST',
    body: formData,
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
  scores: GlobalScoreRecord[];
  nextOffset: number | null;
}> => {
  const search = new URLSearchParams();
  if (options?.limit) search.set('limit', String(options.limit));
  if (options?.offset !== undefined) search.set('offset', String(options.offset));

  const res = await fetch(`/api/global-scores${search.toString() ? `?${search}` : ''}`);
  return parseApiResponse<{ scores: GlobalScoreRecord[]; nextOffset: number | null }>(res);
};

export const saveGlobalScore = async (payload: {
  songId?: string;
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

export const removeLeaderboardPlayer = async (
  token: string,
  username: string,
  reason: string
): Promise<LeaderboardModerationResult> => {
  const res = await fetch('/api/admin/leaderboard/remove-player', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ username, reason }),
  });
  return parseApiResponse<LeaderboardModerationResult>(res);
};

export const forceStorageUpdate = async (token: string): Promise<ForcedStorageUpdateResult> => {
  const res = await fetch('/api/admin/storage/force-update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  return parseApiResponse<ForcedStorageUpdateResult>(res);
};

export const getIntegrityReport = async (): Promise<IntegrityReport> => {
  return parseApiResponse<IntegrityReport>(await fetch('/api/integrity'));
};
