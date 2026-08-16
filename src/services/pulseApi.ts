import { put } from '@vercel/blob/client';
import type { JudgementSummary } from '../types';

export interface ScoreRecord {
  score: number;
  accuracy: number;
  date: string;
  username: string;
  fullCombo: boolean;
}

export interface ScoreSubmissionResult {
  id: string;
  score: GlobalScoreRecord;
  song?: {
    id: string;
    topScore: number;
    scores: ScoreRecord[];
  } | null;
}

export interface CommunitySongRecord {
  id: string;
  name: string;
  artist: string;
  audioUrl: string;
  audioPath: string;
  notesUrl: string;
  notesPath: string;
  coverUrl?: string;
  coverPath?: string;
  tags?: string[];
  chartVersion?: number;
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

export interface MapReview {
  id: string;
  songId: string;
  username: string;
  rating: number;
  body: string;
  createdAt: string;
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
  judgements?: JudgementSummary;
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
  fullCombo: boolean;
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

export type PlayerPresence = 'online' | 'offline' | 'in-game';

export interface PublicProfileRecentRun {
  id: string;
  songId?: string;
  songName: string;
  artist: string;
  score: number;
  accuracy: number;
  fullCombo: boolean;
  playedAt: string;
}

export interface PublicProfileUpdate {
  level: number;
  xp: number;
  achievements: string[];
  favoriteSongIds: string[];
  recentRuns: PublicProfileRecentRun[];
  pulseShards: number;
  selectedAvatar: string;
  selectedBadge?: string;
  selectedTitle: string;
  selectedFrame: string;
  selectedTitleColor?: string;
}

export interface SocialPlayer {
  id: string;
  username: string;
  friendCode: string;
  status: PlayerPresence;
  lastSeen: string;
  friendshipId?: string;
  unread?: number;
  level: number;
  xp: number;
  achievements: string[];
  favoriteSongIds: string[];
  recentRuns: PublicProfileRecentRun[];
  pulseShards: number;
  selectedAvatar: string;
  selectedBadge?: string;
  selectedTitle: string;
  selectedFrame: string;
  selectedTitleColor?: string;
}

export interface SocialMessage {
  id: string;
  senderId: string;
  recipientId?: string;
  roomId?: string;
  body: string;
  kind: 'text' | 'invite' | 'system';
  roomCode?: string;
  createdAt: string;
  readAt?: string;
}

export interface MultiplayerParticipant {
  playerId: string;
  username: string;
  ready: boolean;
  score: number;
  combo: number;
  accuracy: number;
  progress: number;
  finished: boolean;
  joinedAt: string;
  updatedAt: string;
}

export interface MultiplayerSpectator {
  playerId: string;
  username: string;
  joinedAt: string;
}

export interface MultiplayerRoom {
  id: string;
  code: string;
  hostId: string;
  songId: string;
  status: 'lobby' | 'countdown' | 'playing' | 'results';
  startAt?: string;
  createdAt: string;
  updatedAt: string;
  maxPlayers: number;
  participants: MultiplayerParticipant[];
  spectators?: MultiplayerSpectator[];
  rematchVotes?: string[];
}

export interface SocialSnapshot {
  self: SocialPlayer;
  friends: SocialPlayer[];
  pendingIncoming: SocialPlayer[];
  pendingOutgoing: SocialPlayer[];
  activeRoom: MultiplayerRoom | null;
  unreadCount: number;
}

export interface PlayerIdentity {
  playerId: string;
  playerToken: string;
  username: string;
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
const SERVERLESS_MULTIPART_FALLBACK_THRESHOLD_BYTES = 4 * 1024 * 1024;

function getFallbackErrorMessage(rawText: string, status: number) {
  const trimmed = rawText.trim();
  if (!trimmed) return `Request failed (${status})`;
  if (trimmed.startsWith('<')) return `Request failed (${status})`;
  return trimmed.slice(0, 240);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
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
  coverFile?: File;
}) {
  const audioExtension = getAudioExtension(payload.audioFile);
  const audioBaseName = payload.audioFile.name
    ? sanitizeUploadFileName(payload.audioFile.name.replace(audioExtension, ''))
    : 'audio';
  const audioPath = `songs/${payload.id}/${audioBaseName}${audioExtension}`;
  const notesPath = `songs/${payload.id}/notes.json`;
  const notesBlob = new Blob([JSON.stringify(payload.notes)], { type: 'application/json' });

  const [audioUpload, notesUpload] = await Promise.all([
    uploadBlobDirectly(audioPath, payload.audioFile, {
      contentType: payload.audioFile.type || undefined,
      multipart: payload.audioFile.size >= MULTIPART_UPLOAD_THRESHOLD_BYTES,
    }),
    uploadBlobDirectly(notesPath, notesBlob, {
      contentType: 'application/json',
    }),
  ]);

  const coverExtension = payload.coverFile ? getAudioExtension(payload.coverFile) : '';
  const coverPath = payload.coverFile ? `songs/${payload.id}/cover${coverExtension}` : undefined;
  const coverUpload = payload.coverFile && coverPath
    ? await uploadBlobDirectly(coverPath, payload.coverFile, { contentType: payload.coverFile.type || undefined })
    : undefined;

  return {
    audioUrl: audioUpload.url,
    audioPath: audioUpload.pathname,
    notesUrl: notesUpload.url,
    notesPath: notesUpload.pathname,
    ...(coverUpload ? { coverUrl: coverUpload.url, coverPath: coverUpload.pathname } : {}),
  };
}

async function requestBlobClientToken(pathname: string, multipart = false) {
  const res = await fetch(DIRECT_UPLOAD_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'blob.generate-client-token',
      payload: {
        pathname,
        multipart,
        clientPayload: null,
      },
    }),
  });

  const rawText = await res.text();
  let payload: { clientToken?: unknown; error?: unknown } = {};
  if (rawText) {
    try {
      payload = JSON.parse(rawText) as { clientToken?: unknown; error?: unknown };
    } catch {
      payload = {};
    }
  }

  if (!res.ok) {
    const message =
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : getFallbackErrorMessage(rawText, res.status);
    throw new Error(message || 'Failed to prepare direct upload.');
  }

  if (typeof payload.clientToken !== 'string' || !payload.clientToken.trim()) {
    throw new Error('Upload token response was invalid.');
  }

  return payload.clientToken;
}

async function uploadBlobDirectly(
  pathname: string,
  body: Blob | File,
  options: {
    contentType?: string;
    multipart?: boolean;
  }
) {
  const token = await requestBlobClientToken(pathname, Boolean(options.multipart));
  return put(pathname, body, {
    access: 'public',
    token,
    contentType: options.contentType,
    multipart: options.multipart,
  });
}

function createSongUploadFormData(payload: {
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
  tags?: string[];
}) {
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
  formData.append('tags', JSON.stringify(payload.tags || []));
  return formData;
}

async function saveCommunitySongMultipart(payload: {
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
  tags?: string[];
}) {
  const res = await fetch('/api/songs', {
    method: 'POST',
    body: createSongUploadFormData(payload),
  });

  return parseApiResponse<CommunitySongRecord>(res);
}

export const getCommunitySongs = async (): Promise<CommunitySongRecord[]> => {
  return parseApiResponse<CommunitySongRecord[]>(await fetch('/api/songs'));
};

export const getSongById = async (id: string): Promise<CommunitySongRecord> => {
  try {
    return await parseApiResponse<CommunitySongRecord>(await fetch(`/api/songs?id=${encodeURIComponent(id)}`));
  } catch (error) {
    const songs = await getCommunitySongs();
    const match = songs.find((song) => song.id === id);
    if (match) {
      return match;
    }
    throw error;
  }
};

export const getMapReviews = async (songId: string): Promise<MapReview[]> =>
  parseApiResponse<MapReview[]>(await fetch(`/api/map-reviews?songId=${encodeURIComponent(songId)}`));

export const saveMapReview = async (payload: Pick<MapReview, 'songId' | 'username' | 'rating' | 'body'>): Promise<MapReview> =>
  parseApiResponse<MapReview>(await fetch('/api/map-reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));

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
  coverFile?: File;
  tags?: string[];
}): Promise<CommunitySongRecord> => {
  if (!isLocalHostname()) {
    try {
      const id = crypto.randomUUID();
      const uploadedAssets = await uploadSongAssetsDirectly({
        id,
        audioFile: payload.audioFile,
        notes: payload.notes,
        coverFile: payload.coverFile,
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
          tags: payload.tags || [],
          chartVersion: 1,
          ...uploadedAssets,
        }),
      });

      return parseApiResponse<CommunitySongRecord>(res);
    } catch (directUploadError) {
      if (payload.audioFile.size > SERVERLESS_MULTIPART_FALLBACK_THRESHOLD_BYTES) {
        throw new Error(getErrorMessage(directUploadError, 'Direct upload failed.'));
      }

      try {
        return await saveCommunitySongMultipart(payload);
      } catch (fallbackError) {
        const directMessage = getErrorMessage(directUploadError, 'Direct upload failed.');
        const fallbackMessage = getErrorMessage(fallbackError, 'Fallback upload failed.');
        throw new Error(
          directMessage === fallbackMessage
            ? directMessage
            : `${directMessage} Fallback upload also failed: ${fallbackMessage}`
        );
      }
    }
  }

  return saveCommunitySongMultipart(payload);
};

export const updateCommunitySong = async (
  id: string,
  updates: Record<string, unknown>,
  token: string | null
): Promise<CommunitySongRecord> => {
  const res = await fetch(`/api/songs?id=${encodeURIComponent(id)}`, {
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
  const res = await fetch(`/api/songs?id=${encodeURIComponent(id)}`, {
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
  fullCombo: boolean;
  submissionId?: string;
}): Promise<ScoreSubmissionResult> => {
  const submissionId = payload.submissionId || crypto.randomUUID();
  const requestBody = JSON.stringify({ ...payload, submissionId });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch('/api/global-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });
      if (attempt === 0 && (res.status === 408 || res.status === 429 || res.status >= 500)) {
        await new Promise(resolve => window.setTimeout(resolve, 450));
        continue;
      }
      return await parseApiResponse<ScoreSubmissionResult>(res);
    } catch (error) {
      if (attempt === 1) throw error;
      await new Promise(resolve => window.setTimeout(resolve, 450));
    }
  }

  throw new Error('Unable to save score.');
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

async function postJson<T>(url: string, payload: Record<string, unknown>): Promise<T> {
  const { playerToken, ...body } = payload;
  return parseApiResponse<T>(await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(typeof playerToken === 'string' ? { 'X-BeatPulse-Token': playerToken } : {}),
    },
    body: JSON.stringify(body),
  }));
}

const socialEndpoint = (action: string) => `/api/social?action=${encodeURIComponent(action)}`;

const postSocialJson = <T>(action: string, payload: Record<string, unknown>) =>
  postJson<T>(socialEndpoint(action), payload);

export const startSocialSession = (identity: PlayerIdentity) =>
  postSocialJson<SocialSnapshot>('session', { ...identity });

export const updateSocialProfile = (identity: PlayerIdentity, profile: PublicProfileUpdate) =>
  postSocialJson<SocialSnapshot>('profile/update', { ...identity, profile });

export const getSocialSnapshot = async (identity: PlayerIdentity) => {
  const search = new URLSearchParams({ action: 'snapshot', playerId: identity.playerId, username: identity.username });
  return parseApiResponse<SocialSnapshot>(await fetch(`/api/social?${search}`, {
    headers: { 'X-BeatPulse-Token': identity.playerToken },
  }));
};

export const sendFriendRequest = (identity: PlayerIdentity, friendCode: string) =>
  postSocialJson<SocialSnapshot>('friends/request', { ...identity, friendCode });

export const respondToFriendRequest = (identity: PlayerIdentity, friendshipId: string, accept: boolean) =>
  postSocialJson<SocialSnapshot>('friends/respond', { ...identity, friendshipId, accept });

export const removeFriend = (identity: PlayerIdentity, friendId: string) =>
  postSocialJson<SocialSnapshot>('friends/remove', { ...identity, friendId });

export const blockPlayer = (identity: PlayerIdentity, targetId: string, blocked = true) =>
  postSocialJson<SocialSnapshot>('block', { ...identity, targetId, blocked });

export const getDirectMessages = async (identity: PlayerIdentity, friendId: string) => {
  const search = new URLSearchParams({ action: 'messages', playerId: identity.playerId, username: identity.username, friendId });
  return parseApiResponse<SocialMessage[]>(await fetch(`/api/social?${search}`, {
    headers: { 'X-BeatPulse-Token': identity.playerToken },
  }));
};

export const sendDirectMessage = (
  identity: PlayerIdentity,
  recipientId: string,
  body: string,
  invite?: { roomCode: string }
) => postSocialJson<SocialMessage>('messages', {
  ...identity,
  recipientId,
  body,
  ...(invite ? { kind: 'invite', roomCode: invite.roomCode } : {}),
});

export const createMultiplayerRoom = (identity: PlayerIdentity, songId: string) =>
  postSocialJson<MultiplayerRoom>('multiplayer/rooms', { ...identity, songId });

export const joinMultiplayerRoom = (identity: PlayerIdentity, code: string) =>
  postSocialJson<MultiplayerRoom>('multiplayer/rooms/join', { ...identity, code });

export const changeMultiplayerRoomSong = (identity: PlayerIdentity, roomId: string, songId: string) =>
  postSocialJson<MultiplayerRoom>('multiplayer/rooms/song', { ...identity, roomId, songId });

export const setMultiplayerReady = (identity: PlayerIdentity, roomId: string, ready: boolean) =>
  postSocialJson<MultiplayerRoom>('multiplayer/rooms/ready', { ...identity, roomId, ready });

export const startMultiplayerRoom = (identity: PlayerIdentity, roomId: string) =>
  postSocialJson<MultiplayerRoom>('multiplayer/rooms/start', { ...identity, roomId });

export const updateMultiplayerProgress = (
  identity: PlayerIdentity,
  roomId: string,
  progress: { score: number; combo: number; accuracy: number; progress: number; finished?: boolean }
) => postSocialJson<MultiplayerRoom>('multiplayer/rooms/progress', { ...identity, roomId, ...progress });

export const requestMultiplayerRematch = (identity: PlayerIdentity, roomId: string) =>
  postSocialJson<MultiplayerRoom>('multiplayer/rooms/rematch', { ...identity, roomId });

export const leaveMultiplayerRoom = (identity: PlayerIdentity, roomId: string) =>
  postSocialJson<{ left: true }>('multiplayer/rooms/leave', { ...identity, roomId });

export const getRoomMessages = async (identity: PlayerIdentity, roomId: string) => {
  const search = new URLSearchParams({ action: 'multiplayer/rooms/messages', playerId: identity.playerId, username: identity.username, roomId });
  return parseApiResponse<SocialMessage[]>(await fetch(`/api/social?${search}`, {
    headers: { 'X-BeatPulse-Token': identity.playerToken },
  }));
};

export const sendRoomMessage = (identity: PlayerIdentity, roomId: string, body: string) =>
  postSocialJson<SocialMessage>('multiplayer/rooms/messages', { ...identity, roomId, body });
