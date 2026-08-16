import { JudgementSummary } from '../types';

export type VisualThemeUnlock = 'pulse' | 'aurora' | 'sunset';
export type ProfileAvatar = 'pulse' | 'wave' | 'comet' | 'vinyl' | 'prism' | 'nova' | 'synth' | 'echo';
export type ProfileBadge = 'rookie' | 'combo' | 'crown';
export type ProfileTitle = 'newcomer' | 'beat-chaser' | 'pulse-weaver' | 'rhythm-legend';
export type ProfileFrame = 'standard' | 'ripple' | 'crown' | 'prism' | 'orbit';
export type TitleColor = 'violet' | 'cyan' | 'gold';

export type MissionCadence = 'daily' | 'weekly';
export type MissionType = 'accuracy' | 'combo' | 'full-combo' | 'multiplayer' | 'spotlight';

export interface MissionProgress {
  id: string;
  cadence: MissionCadence;
  type: MissionType;
  label: string;
  target: number;
  progress: number;
  rewardXp: number;
  rewardShards: number;
  completed: boolean;
  claimed: boolean;
  songId?: string;
  songName?: string;
}

export interface MissionBoard {
  dailyKey: string;
  weeklyKey: string;
  missions: MissionProgress[];
}

export type SeasonRank = 'Bronze' | 'Silver' | 'Gold' | 'Diamond' | 'Pulse Master';

export interface SeasonRecap {
  season: string;
  rank: SeasonRank;
  points: number;
  runs: number;
}

export type ShopCosmeticKind = 'avatar' | 'frame' | 'lane-theme' | 'hit-sound' | 'menu-theme' | 'title-color';

export interface ShopCosmetic {
  id: string;
  kind: ShopCosmeticKind;
  name: string;
  description: string;
  cost: number;
  unlock: string;
}

export const SHOP_COSMETICS: ShopCosmetic[] = [
  { id: 'avatar-synth', kind: 'avatar', name: 'Synth Avatar', description: 'A polished digital profile avatar.', cost: 450, unlock: 'synth' },
  { id: 'avatar-echo', kind: 'avatar', name: 'Echo Avatar', description: 'A clean reactive profile avatar.', cost: 750, unlock: 'echo' },
  { id: 'frame-orbit', kind: 'frame', name: 'Orbit Frame', description: 'An electric ring around your public profile.', cost: 600, unlock: 'orbit' },
  { id: 'lane-ocean', kind: 'lane-theme', name: 'Ocean Lanes', description: 'A calm blue-green lane palette.', cost: 350, unlock: 'ocean' },
  { id: 'lane-sunset', kind: 'lane-theme', name: 'Sunset Lanes', description: 'A warm, high-energy lane palette.', cost: 350, unlock: 'sunset' },
  { id: 'hit-arcade', kind: 'hit-sound', name: 'Arcade Hit Sound', description: 'A crisp arcade-style judgement sound.', cost: 300, unlock: 'arcade' },
  { id: 'hit-soft', kind: 'hit-sound', name: 'Soft Hit Sound', description: 'A gentler hit-feedback tone.', cost: 300, unlock: 'soft' },
  { id: 'menu-aurora', kind: 'menu-theme', name: 'Aurora Menu', description: 'A luminous menu atmosphere.', cost: 500, unlock: 'aurora' },
  { id: 'title-gold', kind: 'title-color', name: 'Gold Title Color', description: 'Give your equipped title a gold finish.', cost: 400, unlock: 'gold' },
];

export type LevelRewardKind = 'shards' | 'theme' | 'avatar' | 'badge' | 'title' | 'frame';

export interface LevelReward {
  id: string;
  level: number;
  kind: LevelRewardKind;
  label: string;
  description: string;
  amount?: number;
  unlock?: string;
}

export const LEVEL_REWARDS: LevelReward[] = [
  { id: 'level-2-shards', level: 2, kind: 'shards', amount: 250, label: '250 Pulse Shards', description: 'A fresh stack of cosmetic currency.' },
  { id: 'level-3-aurora', level: 3, kind: 'theme', unlock: 'aurora', label: 'Aurora Theme', description: 'A cool, flowing gameplay backdrop.' },
  { id: 'level-3-wave', level: 3, kind: 'avatar', unlock: 'wave', label: 'Wave Avatar', description: 'A new profile identity.' },
  { id: 'level-4-rookie', level: 4, kind: 'badge', unlock: 'rookie', label: 'Rhythm Rookie Badge', description: 'A badge for your public profile.' },
  { id: 'level-5-shards', level: 5, kind: 'shards', amount: 400, label: '400 Pulse Shards', description: 'More currency for future cosmetics.' },
  { id: 'level-6-comet', level: 6, kind: 'avatar', unlock: 'comet', label: 'Comet Avatar', description: 'A fast, bright profile avatar.' },
  { id: 'level-6-ripple', level: 6, kind: 'frame', unlock: 'ripple', label: 'Ripple Frame', description: 'A reactive ring for your player profile.' },
  { id: 'level-7-sunset', level: 7, kind: 'theme', unlock: 'sunset', label: 'Sunset Theme', description: 'A warm gameplay backdrop.' },
  { id: 'level-8-title', level: 8, kind: 'title', unlock: 'beat-chaser', label: 'Beat Chaser Title', description: 'A new title to equip beneath your name.' },
  { id: 'level-9-shards', level: 9, kind: 'shards', amount: 650, label: '650 Pulse Shards', description: 'A milestone currency reward.' },
  { id: 'level-10-crown', level: 10, kind: 'badge', unlock: 'crown', label: 'Neon Crown Badge', description: 'A standout badge for your public profile.' },
  { id: 'level-12-vinyl', level: 12, kind: 'avatar', unlock: 'vinyl', label: 'Vinyl Avatar', description: 'A classic rhythm-game profile icon.' },
  { id: 'level-12-prism-frame', level: 12, kind: 'frame', unlock: 'prism', label: 'Prism Frame', description: 'A multi-color profile ring.' },
  { id: 'level-15-weaver', level: 15, kind: 'title', unlock: 'pulse-weaver', label: 'Pulse Weaver Title', description: 'A title for dedicated chart chasers.' },
  { id: 'level-15-shards', level: 15, kind: 'shards', amount: 1000, label: '1,000 Pulse Shards', description: 'A major milestone currency reward.' },
  { id: 'level-20-nova', level: 20, kind: 'avatar', unlock: 'nova', label: 'Nova Avatar', description: 'A rare profile avatar for long-term players.' },
  { id: 'level-20-legend', level: 20, kind: 'title', unlock: 'rhythm-legend', label: 'Rhythm Legend Title', description: 'A top-tier public title.' },
  { id: 'level-20-crown-frame', level: 20, kind: 'frame', unlock: 'crown', label: 'Crown Frame', description: 'A premium profile frame.' },
];

export interface PlayerRecentRun {
  id: string;
  songId?: string;
  songName: string;
  artist: string;
  score: number;
  accuracy: number;
  fullCombo: boolean;
  playedAt: string;
}

export interface PlayerProgress {
  xp: number;
  level: number;
  runs: number;
  fullCombos: number;
  achievements: string[];
  unlockedThemes: VisualThemeUnlock[];
  mapRatings: Record<string, number>;
  favoriteSongIds: string[];
  recentRuns: PlayerRecentRun[];
  pulseShards: number;
  unlockedAvatars: ProfileAvatar[];
  unlockedBadges: ProfileBadge[];
  unlockedTitles: ProfileTitle[];
  unlockedFrames: ProfileFrame[];
  selectedAvatar: ProfileAvatar;
  selectedBadge?: ProfileBadge;
  selectedTitle: ProfileTitle;
  selectedFrame: ProfileFrame;
  selectedTitleColor: TitleColor;
  unlockedTitleColors: TitleColor[];
  ownedCosmeticIds: string[];
  unlockedLaneThemes: Array<'pulse' | 'colorblind' | 'high-contrast' | 'ocean' | 'sunset'>;
  unlockedHitSounds: Array<'classic' | 'arcade' | 'soft'>;
  unlockedMenuThemes: Array<'pulse' | 'aurora'>;
  missions: MissionBoard;
  seasonPoints: number;
  seasonRuns: number;
  seasonRewardRanks: SeasonRank[];
  lastSeasonRecap?: SeasonRecap;
  season: string;
}

const STORAGE_KEY = 'beatpulse_progress_v2';

const defaultProgress = (): PlayerProgress => ({
  xp: 0,
  level: 1,
  runs: 0,
  fullCombos: 0,
  achievements: [],
  unlockedThemes: ['pulse'],
  mapRatings: {},
  favoriteSongIds: [],
  recentRuns: [],
  pulseShards: 0,
  unlockedAvatars: ['pulse'],
  unlockedBadges: [],
  unlockedTitles: ['newcomer'],
  unlockedFrames: ['standard'],
  selectedAvatar: 'pulse',
  selectedTitle: 'newcomer',
  selectedFrame: 'standard',
  selectedTitleColor: 'violet',
  unlockedTitleColors: ['violet', 'cyan'],
  ownedCosmeticIds: [],
  unlockedLaneThemes: ['pulse', 'colorblind', 'high-contrast'],
  unlockedHitSounds: ['classic'],
  unlockedMenuThemes: ['pulse'],
  missions: { dailyKey: '', weeklyKey: '', missions: [] },
  seasonPoints: 0,
  seasonRuns: 0,
  seasonRewardRanks: [],
  season: new Date().toISOString().slice(0, 7),
});

const levelForXp = (xp: number) => Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 90)) + 1);

const addAchievement = (progress: PlayerProgress, id: string, when: boolean) =>
  when && !progress.achievements.includes(id) ? [...progress.achievements, id] : progress.achievements;

const unlockedFromRewards = <T extends string>(level: number, kind: LevelRewardKind, base: T[], valid: readonly T[]) => {
  const earned = LEVEL_REWARDS
    .filter((reward) => reward.level <= level && reward.kind === kind && typeof reward.unlock === 'string')
    .map((reward) => reward.unlock as T)
    .filter((entry): entry is T => valid.includes(entry));
  return Array.from(new Set([...base.filter((entry): entry is T => valid.includes(entry)), ...earned]));
};

const shardRewardsForLevel = (level: number) => LEVEL_REWARDS
  .filter((reward) => reward.level <= level && reward.kind === 'shards')
  .reduce((total, reward) => total + (reward.amount || 0), 0);

const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);

const weekKey = (date = new Date()) => {
  const utcDay = date.getUTCDay() || 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - utcDay + 1));
  return monday.toISOString().slice(0, 10);
};

const createDailyMissions = (key: string): MissionProgress[] => [
  { id: `daily-accuracy-${key}`, cadence: 'daily', type: 'accuracy', label: 'Precision Pulse', target: 1, progress: 0, rewardXp: 70, rewardShards: 70, completed: false, claimed: false },
  { id: `daily-combo-${key}`, cadence: 'daily', type: 'combo', label: 'Keep the Flow', target: 1, progress: 0, rewardXp: 75, rewardShards: 75, completed: false, claimed: false },
  { id: `daily-full-combo-${key}`, cadence: 'daily', type: 'full-combo', label: 'Clean Sweep', target: 1, progress: 0, rewardXp: 110, rewardShards: 120, completed: false, claimed: false },
];

const createWeeklyMissions = (key: string): MissionProgress[] => [
  { id: `weekly-multiplayer-${key}`, cadence: 'weekly', type: 'multiplayer', label: 'Play Together', target: 2, progress: 0, rewardXp: 220, rewardShards: 260, completed: false, claimed: false },
  { id: `weekly-spotlight-${key}`, cadence: 'weekly', type: 'spotlight', label: 'Spotlight Chart', target: 2, progress: 0, rewardXp: 200, rewardShards: 230, completed: false, claimed: false },
];

const ensureMissions = (missions: MissionBoard | undefined, song?: { id?: string; name: string }): MissionBoard => {
  const currentDay = dayKey();
  const currentWeek = weekKey();
  const existing = Array.isArray(missions?.missions) ? missions!.missions : [];
  const daily = missions?.dailyKey === currentDay
    ? existing.filter((mission) => mission.cadence === 'daily')
    : createDailyMissions(currentDay);
  const weekly = missions?.weeklyKey === currentWeek
    ? existing.filter((mission) => mission.cadence === 'weekly')
    : createWeeklyMissions(currentWeek);
  const next = [...daily, ...weekly];
  if (song?.id) {
    return {
      dailyKey: currentDay,
      weeklyKey: currentWeek,
      missions: next.map((mission) => mission.type === 'spotlight' && !mission.songId ? {
        ...mission,
        songId: song.id,
        songName: song.name,
        label: `Spotlight: ${song.name}`,
      } : mission),
    };
  }
  return { dailyKey: currentDay, weeklyKey: currentWeek, missions: next };
};

export const getSeasonRank = (seasonPoints: number): SeasonRank => {
  if (seasonPoints >= 3600) return 'Pulse Master';
  if (seasonPoints >= 1800) return 'Diamond';
  if (seasonPoints >= 900) return 'Gold';
  if (seasonPoints >= 360) return 'Silver';
  return 'Bronze';
};

const seasonRewardForRank: Partial<Record<SeasonRank, { xp: number; shards: number }>> = {
  Silver: { xp: 180, shards: 220 },
  Gold: { xp: 320, shards: 420 },
  Diamond: { xp: 500, shards: 700 },
  'Pulse Master': { xp: 800, shards: 1100 },
};

const advanceMissionBoard = (board: MissionBoard, input: { accuracy: number; maxCombo: number; fullCombo: boolean; multiplayer: boolean; song?: { id?: string; name: string } }) => {
  const prepared = ensureMissions(board, input.song);
  const completed: MissionProgress[] = [];
  const missions = prepared.missions.map((mission) => {
    if (mission.completed) return mission;
    const qualifies = mission.type === 'accuracy'
      ? input.accuracy >= 92
      : mission.type === 'combo'
        ? input.maxCombo >= 75
        : mission.type === 'full-combo'
          ? input.fullCombo
          : mission.type === 'multiplayer'
            ? input.multiplayer
            : Boolean(mission.songId && input.song?.id === mission.songId);
    if (!qualifies) return mission;
    const progress = Math.min(mission.target, mission.progress + 1);
    const next = { ...mission, progress, completed: progress >= mission.target };
    if (next.completed) completed.push(next);
    return next;
  });
  return { board: { ...prepared, missions }, completed };
};

const normalize = (value: Partial<PlayerProgress> | null | undefined): PlayerProgress => {
  const fallback = defaultProgress();
  const xp = Math.max(0, Number(value?.xp) || 0);
  const level = levelForXp(xp);
  const currentSeason = fallback.season;
  const storedSeason = typeof value?.season === 'string' ? value.season : currentSeason;
  const seasonChanged = storedSeason !== currentSeason;
  const unlockedAvatars = unlockedFromRewards(level, 'avatar', ['pulse', ...(Array.isArray(value?.unlockedAvatars) ? value.unlockedAvatars : [])] as ProfileAvatar[], ['pulse', 'wave', 'comet', 'vinyl', 'prism', 'nova', 'synth', 'echo'] as const);
  const unlockedBadges = unlockedFromRewards(level, 'badge', Array.isArray(value?.unlockedBadges) ? value.unlockedBadges : [], ['rookie', 'combo', 'crown'] as const);
  const unlockedTitles = unlockedFromRewards(level, 'title', ['newcomer', ...(Array.isArray(value?.unlockedTitles) ? value.unlockedTitles : [])] as ProfileTitle[], ['newcomer', 'beat-chaser', 'pulse-weaver', 'rhythm-legend'] as const);
  const unlockedFrames = unlockedFromRewards(level, 'frame', ['standard', ...(Array.isArray(value?.unlockedFrames) ? value.unlockedFrames : [])] as ProfileFrame[], ['standard', 'ripple', 'crown', 'prism', 'orbit'] as const);
  const unlockedThemes = unlockedFromRewards(level, 'theme', ['pulse', ...(Array.isArray(value?.unlockedThemes) ? value.unlockedThemes : [])] as VisualThemeUnlock[], ['pulse', 'aurora', 'sunset'] as const);
  const selectedAvatar = unlockedAvatars.includes(value?.selectedAvatar as ProfileAvatar) ? value!.selectedAvatar as ProfileAvatar : fallback.selectedAvatar;
  const selectedBadge = unlockedBadges.includes(value?.selectedBadge as ProfileBadge) ? value!.selectedBadge as ProfileBadge : undefined;
  const selectedTitle = unlockedTitles.includes(value?.selectedTitle as ProfileTitle) ? value!.selectedTitle as ProfileTitle : fallback.selectedTitle;
  const selectedFrame = unlockedFrames.includes(value?.selectedFrame as ProfileFrame) ? value!.selectedFrame as ProfileFrame : fallback.selectedFrame;
  const missionBoard = ensureMissions(value?.missions);
  const ownedCosmeticIds = Array.isArray(value?.ownedCosmeticIds)
    ? Array.from(new Set(value.ownedCosmeticIds.filter((id): id is string => typeof id === 'string' && SHOP_COSMETICS.some((cosmetic) => cosmetic.id === id))))
    : [];
  const unlockedLaneThemes = Array.isArray(value?.unlockedLaneThemes)
    ? Array.from(new Set(['pulse', 'colorblind', 'high-contrast', ...value.unlockedLaneThemes.filter((theme): theme is PlayerProgress['unlockedLaneThemes'][number] => ['pulse', 'colorblind', 'high-contrast', 'ocean', 'sunset'].includes(theme))])) as PlayerProgress['unlockedLaneThemes']
    : ['pulse', 'colorblind', 'high-contrast'] as PlayerProgress['unlockedLaneThemes'];
  const unlockedHitSounds = Array.isArray(value?.unlockedHitSounds)
    ? Array.from(new Set(['classic', ...value.unlockedHitSounds.filter((sound): sound is PlayerProgress['unlockedHitSounds'][number] => ['classic', 'arcade', 'soft'].includes(sound))])) as PlayerProgress['unlockedHitSounds']
    : ['classic'] as PlayerProgress['unlockedHitSounds'];
  const unlockedMenuThemes = Array.isArray(value?.unlockedMenuThemes)
    ? Array.from(new Set(['pulse', ...value.unlockedMenuThemes.filter((theme): theme is PlayerProgress['unlockedMenuThemes'][number] => ['pulse', 'aurora'].includes(theme))])) as PlayerProgress['unlockedMenuThemes']
    : ['pulse'] as PlayerProgress['unlockedMenuThemes'];
  const unlockedTitleColors = Array.isArray(value?.unlockedTitleColors)
    ? Array.from(new Set(['violet', 'cyan', ...value.unlockedTitleColors.filter((color): color is TitleColor => ['violet', 'cyan', 'gold'].includes(color))])) as TitleColor[]
    : ['violet', 'cyan'] as TitleColor[];
  const selectedTitleColor = unlockedTitleColors.includes(value?.selectedTitleColor as TitleColor) ? value!.selectedTitleColor as TitleColor : fallback.selectedTitleColor;
  const previousSeasonPoints = Math.max(0, Math.round(Number(value?.seasonPoints) || 0));
  const previousSeasonRuns = Math.max(0, Math.round(Number(value?.seasonRuns) || 0));
  const lastSeasonRecap = seasonChanged && storedSeason
    ? { season: storedSeason, rank: getSeasonRank(previousSeasonPoints), points: previousSeasonPoints, runs: previousSeasonRuns }
    : value?.lastSeasonRecap;
  return {
    ...fallback,
    ...value,
    xp,
    level,
    runs: Math.max(0, Number(value?.runs) || 0),
    fullCombos: Math.max(0, Number(value?.fullCombos) || 0),
    achievements: Array.isArray(value?.achievements) ? value!.achievements.filter((entry): entry is string => typeof entry === 'string') : [],
    unlockedThemes,
    mapRatings: value?.mapRatings && typeof value.mapRatings === 'object' ? value.mapRatings : {},
    favoriteSongIds: Array.isArray(value?.favoriteSongIds)
      ? Array.from(new Set(value.favoriteSongIds.filter((id): id is string => typeof id === 'string' && id.length > 0))).slice(0, 12)
      : [],
    recentRuns: Array.isArray(value?.recentRuns)
      ? value.recentRuns
        .filter((run): run is PlayerRecentRun => Boolean(run && typeof run === 'object' && typeof (run as PlayerRecentRun).songName === 'string'))
        .slice(0, 12)
        .map((run) => ({
          id: typeof run.id === 'string' ? run.id : crypto.randomUUID(),
          songId: typeof run.songId === 'string' ? run.songId : undefined,
          songName: run.songName.slice(0, 100),
          artist: typeof run.artist === 'string' ? run.artist.slice(0, 100) : 'Unknown Artist',
          score: Math.max(0, Number(run.score) || 0),
          accuracy: Math.max(0, Math.min(100, Number(run.accuracy) || 0)),
          fullCombo: run.fullCombo === true,
          playedAt: typeof run.playedAt === 'string' ? run.playedAt : new Date().toISOString(),
        }))
      : [],
    pulseShards: Math.max(shardRewardsForLevel(level), Math.max(0, Number(value?.pulseShards) || 0)),
    unlockedAvatars,
    unlockedBadges,
    unlockedTitles,
    unlockedFrames,
    selectedAvatar,
    selectedBadge,
    selectedTitle,
    selectedFrame,
    selectedTitleColor,
    unlockedTitleColors,
    ownedCosmeticIds,
    unlockedLaneThemes,
    unlockedHitSounds,
    unlockedMenuThemes,
    missions: missionBoard,
    seasonPoints: seasonChanged ? 0 : previousSeasonPoints,
    seasonRuns: seasonChanged ? 0 : previousSeasonRuns,
    seasonRewardRanks: seasonChanged ? [] : Array.isArray(value?.seasonRewardRanks) ? value.seasonRewardRanks.filter((rank): rank is SeasonRank => ['Bronze', 'Silver', 'Gold', 'Diamond', 'Pulse Master'].includes(rank)) : [],
    lastSeasonRecap,
    season: currentSeason,
  };
};

const persist = (progress: PlayerProgress) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  return progress;
};

export const loadPlayerProgress = (): PlayerProgress => {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return defaultProgress();
  }
};

export const getSeasonTier = (progress: PlayerProgress) => {
  if (progress.xp >= 3600) return 'Pulse Master';
  if (progress.xp >= 1800) return 'Diamond Pulse';
  if (progress.xp >= 900) return 'Gold Pulse';
  if (progress.xp >= 360) return 'Silver Pulse';
  return 'Bronze Pulse';
};

export const awardRunProgress = (input: {
  score: number;
  accuracy: number;
  maxCombo: number;
  fullCombo: boolean;
  judgements: JudgementSummary;
  song?: { id?: string; name: string; artist: string };
  multiplayer?: boolean;
  ranked?: boolean;
}) => {
  const current = loadPlayerProgress();
  const cleanAccuracy = Math.max(0, Math.min(100, input.accuracy));
  const earnedXp = Math.max(25, Math.round(35 + cleanAccuracy * 0.7 + Math.min(80, input.maxCombo) * 0.35 + (input.fullCombo ? 55 : 0)));
  const next: PlayerProgress = {
    ...current,
    xp: current.xp + earnedXp,
    runs: current.runs + 1,
    fullCombos: current.fullCombos + (input.fullCombo ? 1 : 0),
  };
  if (input.song) {
    next.recentRuns = [{
      id: crypto.randomUUID(),
      songId: input.song.id,
      songName: input.song.name,
      artist: input.song.artist,
      score: Math.max(0, Math.round(input.score)),
      accuracy: cleanAccuracy,
      fullCombo: input.fullCombo,
      playedAt: new Date().toISOString(),
    }, ...current.recentRuns].slice(0, 12);
  }
  next.level = levelForXp(next.xp);
  next.achievements = addAchievement(next, 'first-run', next.runs >= 1);
  next.achievements = addAchievement(next, 'combo-50', input.maxCombo >= 50);
  next.achievements = addAchievement(next, 'accuracy-95', cleanAccuracy >= 95);
  next.achievements = addAchievement(next, 'full-combo', input.fullCombo);
  next.achievements = addAchievement(next, 'ten-runs', next.runs >= 10);
  if (input.maxCombo >= 50 && !next.unlockedBadges.includes('combo')) next.unlockedBadges.push('combo');
  const missionUpdate = advanceMissionBoard(current.missions, {
    accuracy: cleanAccuracy,
    maxCombo: input.maxCombo,
    fullCombo: input.fullCombo,
    multiplayer: input.multiplayer === true,
    song: input.song,
  });
  next.missions = missionUpdate.board;
  const seasonPoints = input.ranked === false
    ? 0
    : Math.max(12, Math.round(cleanAccuracy * 1.4 + Math.min(input.maxCombo, 100) * 0.55 + (input.fullCombo ? 45 : 0)));
  next.seasonPoints = current.seasonPoints + seasonPoints;
  next.seasonRuns = current.seasonRuns + (input.ranked === false ? 0 : 1);
  const progress = persist(normalize(next));
  const levelUpRewards = LEVEL_REWARDS.filter((reward) => reward.level > current.level && reward.level <= progress.level);
  return { progress, earnedXp, levelUpRewards, previousLevel: current.level, completedMissions: missionUpdate.completed, seasonPoints };
};

export const rateMap = (songId: string, rating: number) => {
  const current = loadPlayerProgress();
  const next = normalize({ ...current, mapRatings: { ...current.mapRatings, [songId]: Math.max(1, Math.min(5, Math.round(rating))) } });
  return persist(next);
};

export const toggleFavoriteSong = (songId: string) => {
  const current = loadPlayerProgress();
  const isFavorite = current.favoriteSongIds.includes(songId);
  const favoriteSongIds = isFavorite
    ? current.favoriteSongIds.filter((id) => id !== songId)
    : [songId, ...current.favoriteSongIds].slice(0, 12);
  return persist(normalize({ ...current, favoriteSongIds }));
};

export const updateProfileLoadout = (updates: Partial<Pick<PlayerProgress, 'selectedAvatar' | 'selectedBadge' | 'selectedTitle' | 'selectedFrame' | 'selectedTitleColor'>>) => {
  const current = loadPlayerProgress();
  return persist(normalize({ ...current, ...updates }));
};

export const getUpcomingLevelRewards = (level: number) => LEVEL_REWARDS
  .filter((reward) => reward.level > level)
  .slice(0, 3);

export const claimMissionReward = (missionId: string) => {
  const current = loadPlayerProgress();
  const mission = current.missions.missions.find((entry) => entry.id === missionId);
  if (!mission || !mission.completed || mission.claimed) return null;
  const missions = current.missions.missions.map((entry) => entry.id === missionId ? { ...entry, claimed: true } : entry);
  const next = normalize({
    ...current,
    xp: current.xp + mission.rewardXp,
    pulseShards: current.pulseShards + mission.rewardShards,
    missions: { ...current.missions, missions },
  });
  const progress = persist(next);
  const levelUpRewards = LEVEL_REWARDS.filter((reward) => reward.level > current.level && reward.level <= progress.level);
  return { progress, mission, levelUpRewards };
};

export const purchaseCosmetic = (cosmeticId: string) => {
  const current = loadPlayerProgress();
  const cosmetic = SHOP_COSMETICS.find((entry) => entry.id === cosmeticId);
  if (!cosmetic) return { error: 'That cosmetic is no longer available.' as const };
  if (current.ownedCosmeticIds.includes(cosmetic.id)) return { error: 'You already own this cosmetic.' as const };
  if (current.pulseShards < cosmetic.cost) return { error: `You need ${cosmetic.cost - current.pulseShards} more Pulse Shards.` as const };
  const next: PlayerProgress = {
    ...current,
    pulseShards: current.pulseShards - cosmetic.cost,
    ownedCosmeticIds: [...current.ownedCosmeticIds, cosmetic.id],
  };
  if (cosmetic.kind === 'avatar') next.unlockedAvatars = [...current.unlockedAvatars, cosmetic.unlock as ProfileAvatar];
  if (cosmetic.kind === 'frame') next.unlockedFrames = [...current.unlockedFrames, cosmetic.unlock as ProfileFrame];
  if (cosmetic.kind === 'lane-theme') next.unlockedLaneThemes = [...current.unlockedLaneThemes, cosmetic.unlock as PlayerProgress['unlockedLaneThemes'][number]];
  if (cosmetic.kind === 'hit-sound') next.unlockedHitSounds = [...current.unlockedHitSounds, cosmetic.unlock as PlayerProgress['unlockedHitSounds'][number]];
  if (cosmetic.kind === 'menu-theme') next.unlockedMenuThemes = [...current.unlockedMenuThemes, cosmetic.unlock as PlayerProgress['unlockedMenuThemes'][number]];
  if (cosmetic.kind === 'title-color') next.unlockedTitleColors = [...current.unlockedTitleColors, cosmetic.unlock as TitleColor];
  const progress = persist(normalize(next));
  return { progress, cosmetic };
};

export const claimSeasonReward = () => {
  const current = loadPlayerProgress();
  const rank = getSeasonRank(current.seasonPoints);
  const reward = seasonRewardForRank[rank];
  if (!reward || current.seasonRewardRanks.includes(rank)) return null;
  const next = normalize({
    ...current,
    xp: current.xp + reward.xp,
    pulseShards: current.pulseShards + reward.shards,
    seasonRewardRanks: [...current.seasonRewardRanks, rank],
  });
  const progress = persist(next);
  const levelUpRewards = LEVEL_REWARDS.filter((entry) => entry.level > current.level && entry.level <= progress.level);
  return { progress, rank, reward, levelUpRewards };
};
