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

interface ApiErrorResponse {
  success: false;
  error: string;
}

interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

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
