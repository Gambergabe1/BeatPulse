import React, { lazy, Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useMemo } from 'react';
import {
  Music,
  Upload,
  Play,
  Trophy,
  Disc,
  Cloud,
  Save,
  User,
  Users,
  Lock,
  Edit2,
  Check,
  Activity,
  Settings as SettingsIcon,
  ArrowLeft
} from 'lucide-react';
import { loadAudioFile } from '../utils/audio';
import { generateChart } from '../utils/chartGenerator';
import { generateChartBundle, pickOfficialChart, toPlayableCharts } from '../utils/storedCharts';
import { getSongRecords } from '../utils/chartRecords';
import { CURRENT_CHART_VERSION, difficultyIdForValue, parseChartBundle } from '../../shared/chartFormat';
import { DEFAULT_DIFFICULTY, DIFFICULTY_PRESETS, getChartSettingsForDifficulty, getDifficultyPreset } from '../utils/chartSettings';
import { DEFAULT_GAMEPLAY_OPTIONS, GameplayOptions, SongData, Settings } from '../types';
import {
  changeAdminPassword,
  deleteCommunitySong,
  forceStorageUpdate,
  GlobalScoreLinkIssue,
  getCommunitySongs,
  getGlobalScores,
  GlobalScoreRecord,
  getIntegrityReport,
  IntegrityReport,
  getReplays,
  loginAdmin,
  removeLeaderboardPlayer,
  ReplayLinkIssue,
  saveCommunitySong,
  updateCommunitySong,
  updateSocialProfile,
  MultiplayerRoom,
  PlayerIdentity,
  fetchSongAsset,
  replaceSongCharts
} from '../services/pulseApi';
import { IntegrityResultRow, MainTab } from './menuShared';
import { DailyChallengeCard } from './DailyChallengeCard';
import { SongLibrary } from './SongLibrary';
import { getPlayerId, getPlayerToken } from '../utils/playerIdentity';
import { prefersMovingSliders } from '../utils/device';
import { getSeasonTier, getUpcomingLevelRewards, PlayerProgress, toggleFavoriteSong, updateProfileLoadout } from '../utils/progression';


// Tabs and tools most players never open load on demand, keeping the first load small.
const SocialHub = lazy(() => import('./SocialHub').then((module) => ({ default: module.SocialHub })));
const AdminPanel = lazy(() => import('./AdminPanel').then((module) => ({ default: module.AdminPanel })));
const SettingsPanel = lazy(() => import('./SettingsPanel').then((module) => ({ default: module.SettingsPanel })));
const BeatmapEditor = lazy(() => import('./BeatmapEditor').then((module) => ({ default: module.BeatmapEditor })));
const ProgressionHub = lazy(() => import('./ProgressionHub').then((module) => ({ default: module.ProgressionHub })));

const PanelFallback = () => (
  <div className="flex items-center justify-center py-16" role="status">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-neon-blue" />
    <span className="sr-only">Loading…</span>
  </div>
);

interface MenuProps {
  onStartGame: (songData: SongData, isReplay?: boolean, replayEvents?: any[], multiplayer?: MultiplayerRoom) => void;
  audioContext: AudioContext;
  settings: Settings;
  onSaveSettings: (settings: Settings) => void;
  progress: PlayerProgress;
  onUpdateProgress: (progress: PlayerProgress) => void;
}


const LEADERBOARD_REMOVAL_REASONS = [
  'Inappropriate name',
  'Cheating or impossible score',
  'Spam or duplicate entries',
  'Offensive content',
  'Requested removal',
];

const DEFAULT_CHART_SETTINGS = getChartSettingsForDifficulty(DEFAULT_DIFFICULTY);


const getSettingTier = (value: number, labels: [string, string, string, string]) => {
  if (value < 0.25) return labels[0];
  if (value < 0.5) return labels[1];
  if (value < 0.75) return labels[2];
  return labels[3];
};

const getSliderTier = (value: number) => {
  if (value < 0.17) return 'Rare';
  if (value < 0.28) return 'Occasional';
  if (value < 0.39) return 'Frequent';
  return 'Flowing';
};

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const getTopScoreFromEntries = (entries: Array<{ score: number }>) =>
  entries.reduce((max, entry) => Math.max(max, Number(entry.score) || 0), 0);


const describeReplayLinkIssue = (issue: ReplayLinkIssue) => {
  if (issue.issue === 'missing-song') {
    return `Replay references a missing song (${issue.songId || 'no song id'}).`;
  }

  return `Replay metadata is out of sync. Expected ${issue.expectedSongName || 'unknown'} by ${issue.expectedArtist || 'unknown'}.`;
};

const describeGlobalScoreLinkIssue = (issue: GlobalScoreLinkIssue) => {
  if (issue.issue === 'missing-song') {
    return `Leaderboard entry references a missing song id (${issue.songId || 'none'}).`;
  }

  if (issue.issue === 'missing-song-link') {
    return `Leaderboard entry can be linked to ${issue.expectedSongName || 'a song'} but is missing its song id.`;
  }

  return `Leaderboard metadata is out of sync. Expected ${issue.expectedSongName || 'unknown'} by ${issue.expectedArtist || 'unknown'}.`;
};

export const Menu: React.FC<MenuProps> = ({ onStartGame, audioContext, settings, onSaveSettings, progress, onUpdateProgress }) => {
  const initialComplexity = settings.complexity ?? DEFAULT_DIFFICULTY;
  const initialChartSettings = getChartSettingsForDifficulty(initialComplexity);
  const [isUploading, setIsUploading] = useState(false);
  const [readySong, setReadySong] = useState<SongData | null>(null);
  const [metadata, setMetadata] = useState({ name: '', artist: '' });
  const [error, setError] = useState<string | null>(null);
  const [complexity, setComplexity] = useState(initialComplexity);
  const [density, setDensity] = useState(settings.density ?? initialChartSettings.density);
  const [laneVariety, setLaneVariety] = useState(settings.laneVariety ?? initialChartSettings.laneVariety);
  const [sliderProbability, setSliderProbability] = useState(settings.sliderProbability ?? initialChartSettings.sliderProbability);
  const [stamina, setStamina] = useState(settings.stamina ?? initialChartSettings.stamina);
  const [advancedChartMode, setAdvancedChartMode] = useState(settings.advancedChartMode ?? false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [communitySongs, setCommunitySongs] = useState<any[]>([]);
  const [globalScores, setGlobalScores] = useState<GlobalScoreRecord[]>([]);
  const [globalScoresOffset, setGlobalScoresOffset] = useState<number>(0);
  const [isLoadingMoreScores, setIsLoadingMoreScores] = useState(false);
  const [hasMoreScores, setHasMoreScores] = useState(true);
  const [activeTab, setActiveTab] = useState<MainTab | 'ADMIN'>('LOCAL');
  const [lastMainTab, setLastMainTab] = useState<MainTab>('LOCAL');
  const [isSaving, setIsSaving] = useState(false);
  const [lastUploadedFile, setLastUploadedFile] = useState<File | null>(null);
  const [lastUploadedCover, setLastUploadedCover] = useState<File | null>(null);
  const [mapTags, setMapTags] = useState('');
  const [username, setUsername] = useState(localStorage.getItem('username') || 'Anonymous');
  const playerId = useMemo(() => getPlayerId(), []);
  const playerToken = useMemo(() => getPlayerToken(), []);
  const movingSlidersEnabled = useMemo(prefersMovingSliders, []);
  const playerIdentity = useMemo<PlayerIdentity>(() => ({
    playerId,
    playerToken,
    username: username.trim() || 'Anonymous',
  }), [playerId, playerToken, username]);
  const handleToggleFavorite = useCallback((songId: string) => {
    onUpdateProgress(toggleFavoriteSong(songId));
  }, [onUpdateProgress]);
  const handleProfileLoadout = useCallback((updates: Partial<Pick<PlayerProgress, 'selectedAvatar' | 'selectedBadge' | 'selectedTitle' | 'selectedFrame' | 'selectedTitleColor'>>) => {
    onUpdateProgress(updateProfileLoadout(updates));
  }, [onUpdateProgress]);
  const handleChartNotesChange = useCallback((notes: SongData['notes']) => {
    setReadySong((current) => current ? { ...current, notes } : current);
  }, []);
  
  // Admin states
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(localStorage.getItem('adminToken'));
  const [adminPassword, setAdminPassword] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [editingSong, setEditingSong] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ name: '', artist: '', difficulty: 0.5, density: 0.5, laneVariety: 0.5, sliderProbability: 0.3, stamina: 0.5 });
  const [integrityResults, setIntegrityResults] = useState<IntegrityResultRow[] | null>(null);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [isAdminLoading, setIsAdminLoading] = useState(false);
  const [isForcingStorageUpdate, setIsForcingStorageUpdate] = useState(false);
  const [isModeratingLeaderboard, setIsModeratingLeaderboard] = useState(false);
  const [loadingSongId, setLoadingSongId] = useState<string | null>(null);
  const [chartRebuildStatus, setChartRebuildStatus] = useState<string | null>(null);
  const [leaderboardRemovalTarget, setLeaderboardRemovalTarget] = useState<GlobalScoreRecord | null>(null);
  const [leaderboardRemovalReason, setLeaderboardRemovalReason] = useState(LEADERBOARD_REMOVAL_REASONS[0]);
  
  // Settings states
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [activeKeybindIndex, setActiveKeybindIndex] = useState<number | null>(null);
  const [savedReplays, setSavedReplays] = useState<any[]>([]);
  const sharedReplayIdRef = useRef(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('replay'));
  const [isEditingChart, setIsEditingChart] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimeoutRef = useRef<any>(null);
  const gameplayOptions = { ...DEFAULT_GAMEPLAY_OPTIONS, ...(localSettings.gameplay || {}) };
  const upcomingLevelRewards = getUpcomingLevelRewards(progress.level);

  const updateGameplayOptions = (changes: Partial<GameplayOptions>) => {
    const nextSettings = {
      ...localSettings,
      gameplay: { ...gameplayOptions, ...changes },
    };
    setLocalSettings(nextSettings);
    onSaveSettings(nextSettings);
  };
  const isAdminPage = activeTab === 'ADMIN';
  const sectionMeta = ({
    LOCAL: { lead: 'Play', accent: 'Studio', subtitle: 'Load a track and shape your chart', icon: Activity, color: 'text-neon-blue' },
    COMMUNITY: { lead: 'Community', accent: 'Library', subtitle: 'Discover player-made rhythm charts', icon: Cloud, color: 'text-neon-blue' },
    SOCIAL: { lead: 'Pulse', accent: 'Network', subtitle: 'Friends · Messages · Live Matches', icon: Users, color: 'text-neon-purple' },
    PROGRESS: { lead: 'Player', accent: 'Progress', subtitle: 'Missions · Shop · Ranked · Achievements', icon: Trophy, color: 'text-neon-orange' },
    GLOBAL: { lead: 'Global', accent: 'Rankings', subtitle: 'The best runs across every chart', icon: Trophy, color: 'text-neon-green' },
    REPLAYS: { lead: 'Replay', accent: 'Vault', subtitle: 'Rewatch and study your saved performances', icon: Play, color: 'text-neon-blue' },
    SETTINGS: { lead: 'Player', accent: 'Setup', subtitle: 'Tune controls, charts, visuals, and sound', icon: SettingsIcon, color: 'text-neon-purple' },
  } satisfies Record<MainTab, { lead: string; accent: string; subtitle: string; icon: React.ElementType; color: string }>)[activeTab === 'ADMIN' ? 'LOCAL' : activeTab];
  const SectionIcon = sectionMeta.icon;
  const chartSettings = getChartSettingsForDifficulty(complexity);
  const difficultyPreset = getDifficultyPreset(complexity);
  const songRecords = useMemo(() => readySong
    ? getSongRecords({ songId: readySong.id, name: readySong.name, artist: readySong.artist, duration: readySong.audioBuffer.duration })
    : [],
  // Records change after each run; the menu remounts after a run so this stays fresh.
  [readySong?.id, readySong?.name, readySong?.artist, readySong?.audioBuffer]);
  const effectiveDensity = advancedChartMode ? density : chartSettings.density;
  const effectiveLaneVariety = advancedChartMode ? laneVariety : chartSettings.laneVariety;
  const effectiveSliderProbability = advancedChartMode ? sliderProbability : chartSettings.sliderProbability;
  const effectiveStamina = advancedChartMode ? stamina : chartSettings.stamina;
  const chartProfileRows = [
    {
      label: 'Note Density',
      value: effectiveDensity,
      summary: getSettingTier(effectiveDensity, ['Light', 'Steady', 'Busy', 'Dense'] as const),
      accentClass: 'text-neon-green',
    },
    {
      label: 'Lane Movement',
      value: effectiveLaneVariety,
      summary: getSettingTier(effectiveLaneVariety, ['Stable', 'Mixed', 'Active', 'Wild'] as const),
      accentClass: 'text-neon-pink',
    },
    {
      label: movingSlidersEnabled ? 'Holds & Slides' : 'Hold Notes',
      value: effectiveSliderProbability,
      summary: getSliderTier(effectiveSliderProbability),
      accentClass: 'text-neon-blue',
    },
    {
      label: 'Stamina',
      value: effectiveStamina,
      summary: getSettingTier(effectiveStamina, ['Relaxed', 'Standard', 'Demanding', 'Endurance'] as const),
      accentClass: 'text-neon-orange',
    },
  ];
  const advancedControls = [
    {
      id: 'density',
      label: 'Density',
      hint: 'How many notes show up.',
      value: density,
      onChange: setDensity,
      accentClass: 'accent-neon-green',
      valueClass: 'text-neon-green',
      badgeClass: 'border-neon-green/20 bg-neon-green/10 text-neon-green',
      minLabel: 'Light',
      maxLabel: 'Dense',
      summary: getSettingTier(density, ['Light', 'Steady', 'Busy', 'Dense'] as const),
    },
    {
      id: 'laneVariety',
      label: 'Lane Variety',
      hint: 'How often patterns move around.',
      value: laneVariety,
      onChange: setLaneVariety,
      accentClass: 'accent-neon-pink',
      valueClass: 'text-neon-pink',
      badgeClass: 'border-neon-pink/20 bg-neon-pink/10 text-neon-pink',
      minLabel: 'Stable',
      maxLabel: 'Wild',
      summary: getSettingTier(laneVariety, ['Stable', 'Mixed', 'Active', 'Wild'] as const),
    },
    {
      id: 'sliderProbability',
      label: movingSlidersEnabled ? 'Holds & Slides' : 'Hold Notes',
      hint: movingSlidersEnabled
        ? 'How often sustained and moving notes appear.'
        : 'How often straight single-lane holds appear.',
      value: sliderProbability,
      onChange: setSliderProbability,
      accentClass: 'accent-neon-blue',
      valueClass: 'text-neon-blue',
      badgeClass: 'border-neon-blue/20 bg-neon-blue/10 text-neon-blue',
      minLabel: 'Rare',
      maxLabel: 'Frequent',
      summary: getSliderTier(sliderProbability),
    },
    {
      id: 'stamina',
      label: 'Stamina',
      hint: 'How hard long bursts can push.',
      value: stamina,
      onChange: setStamina,
      accentClass: 'accent-neon-orange',
      valueClass: 'text-neon-orange',
      badgeClass: 'border-neon-orange/20 bg-neon-orange/10 text-neon-orange',
      minLabel: 'Relaxed',
      maxLabel: 'Demanding',
      summary: getSettingTier(stamina, ['Relaxed', 'Standard', 'Demanding', 'Endurance'] as const),
    },
  ];
  const keybindingPrompt =
    activeKeybindIndex !== null
      ? `Press a key for Lane ${activeKeybindIndex + 1}.`
      : 'Click a lane to change its key.';

  const applyChartProfile = (profile: ReturnType<typeof getChartSettingsForDifficulty>) => {
    setDensity(profile.density);
    setLaneVariety(profile.laneVariety);
    setSliderProbability(profile.sliderProbability);
    setStamina(profile.stamina);
  };

  const toggleAdvancedChartMode = () => {
    if (!advancedChartMode) {
      applyChartProfile(getChartSettingsForDifficulty(complexity));
    }
    setAdvancedChartMode((current) => !current);
  };

  const selectDifficultyPreset = (value: number) => {
    setComplexity(value);
    setAdvancedChartMode(false);
  };

  const resetChartSettings = () => {
    setComplexity(DEFAULT_CHART_SETTINGS.complexity);
    applyChartProfile(DEFAULT_CHART_SETTINGS);
    setAdvancedChartMode(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeKeybindIndex !== null) {
        e.preventDefault();
        const newKeybindings = [...localSettings.keybindings] as [string, string, string, string];
        newKeybindings[activeKeybindIndex] = e.key.toLowerCase();
        
        const updatedSettings = { ...localSettings, keybindings: newKeybindings };
        setLocalSettings(updatedSettings);
        onSaveSettings(updatedSettings);
        setActiveKeybindIndex(null);
      }
    };

    if (activeKeybindIndex !== null) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeKeybindIndex, localSettings, onSaveSettings]);

  useEffect(() => {
    localStorage.setItem('username', username);
  }, [username]);

  useEffect(() => {
    void updateSocialProfile(playerIdentity, {
      level: progress.level,
      xp: progress.xp,
      achievements: progress.achievements,
      favoriteSongIds: progress.favoriteSongIds,
      recentRuns: progress.recentRuns,
      pulseShards: progress.pulseShards,
      selectedAvatar: progress.selectedAvatar,
      selectedBadge: progress.selectedBadge,
      selectedTitle: progress.selectedTitle,
      selectedFrame: progress.selectedFrame,
      selectedTitleColor: progress.selectedTitleColor,
    }).catch(() => {
      // The profile still works locally when the optional social service is unavailable.
    });
  }, [playerIdentity, progress.achievements, progress.favoriteSongIds, progress.level, progress.pulseShards, progress.recentRuns, progress.selectedAvatar, progress.selectedBadge, progress.selectedFrame, progress.selectedTitle, progress.selectedTitleColor, progress.xp]);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  // Sync generation settings to parent settings
  useEffect(() => {
    const updatedSettings = {
      ...settings,
      advancedChartMode,
      complexity,
      density: effectiveDensity,
      laneVariety: effectiveLaneVariety,
      sliderProbability: effectiveSliderProbability,
      stamina: effectiveStamina
    };
    onSaveSettings(updatedSettings);
  }, [advancedChartMode, complexity, effectiveDensity, effectiveLaneVariety, effectiveSliderProbability, effectiveStamina]);

  const loadCommunitySongs = useCallback(async () => {
    try {
      const songs = await getCommunitySongs();
      setCommunitySongs(songs);
    } catch (err) {
      console.error('Failed to fetch songs:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load community songs: ${message}`);
    }
  }, []);

  const loadGlobalScores = useCallback(async () => {
    try {
      const { scores, nextOffset } = await getGlobalScores({ limit: 100, offset: 0 });
      setGlobalScores(scores);
      setGlobalScoresOffset(nextOffset || 0);
      setHasMoreScores(nextOffset !== null);
    } catch (err) {
      console.error('Failed to fetch global scores:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load global scores: ${message}`);
    }
  }, []);

  const loadReplays = useCallback(async () => {
    try {
      const replays = await getReplays();
      setSavedReplays(replays);
    } catch (err) {
      console.error('Failed to fetch replays:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load replays: ${message}`);
    }
  }, []);

  const refreshStoredCollections = useCallback(async () => {
    await Promise.all([loadCommunitySongs(), loadGlobalScores(), loadReplays()]);
  }, [loadCommunitySongs, loadGlobalScores, loadReplays]);

  useEffect(() => {
    refreshStoredCollections();
  }, [refreshStoredCollections]);

  // Dynamic note scaling when complexity changes
  useEffect(() => {
    if (!readySong) return;

    let cancelled = false;
    // Community songs play their official stored chart for the chosen difficulty.
    const official = pickOfficialChart(readySong.charts, complexity, advancedChartMode);
    if (official) {
      if (readySong.officialChart !== official.id || readySong.difficulty !== complexity) {
        setReadySong(prev => prev ? {
          ...prev,
          notes: official.notes,
          officialChart: official.id,
          difficulty: complexity,
          ...getChartSettingsForDifficulty(complexity),
        } : null);
      }
      return;
    }
    const timer = setTimeout(async () => {
      setIsRegenerating(true);
      try {
        const { notes: newNotes } = await generateChart(readySong.audioBuffer, {
          complexity,
          density: effectiveDensity,
          laneVariety: effectiveLaneVariety,
          sliderProbability: effectiveSliderProbability,
          stamina: effectiveStamina,
          allowMovingSliders: movingSlidersEnabled
        });
        if (cancelled) return;
        setReadySong(prev => prev ? {
          ...prev,
          notes: newNotes,
          officialChart: undefined,
          difficulty: complexity,
          density: effectiveDensity,
          laneVariety: effectiveLaneVariety,
          sliderProbability: effectiveSliderProbability,
          stamina: effectiveStamina
        } : null);
      } catch (err) {
        console.error("Failed to regenerate notes:", err);
      } finally {
        if (!cancelled) setIsRegenerating(false);
      }
    }, 400); // 400ms debounce

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [advancedChartMode, complexity, effectiveDensity, effectiveLaneVariety, effectiveSliderProbability, effectiveStamina, movingSlidersEnabled, readySong?.audioBuffer, readySong?.charts]);

  const loadStoredSongData = useCallback(async (
    song: any,
    chartOverrides?: Partial<Pick<SongData, 'difficulty' | 'density' | 'laneVariety' | 'sliderProbability' | 'stamina'>>
  ): Promise<SongData> => {
    if (!song.audioUrl) {
      throw new Error('Audio URL is missing');
    }

    const [arrayBuffer, storedNotes] = await Promise.all([
      fetchSongAsset(song.audioUrl).then((response) => response.arrayBuffer()),
      song.notesUrl
        ? fetchSongAsset(song.notesUrl).then((response) => response.json()).catch((error) => {
          console.warn('Failed to fetch stored charts, generating locally.', error);
          return null;
        })
        : Promise.resolve(null),
    ]);
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Replays and multiplayer pass the difficulty they were played at; otherwise the menu's choice is used.
    const difficulty = chartOverrides?.difficulty ?? complexity;
    const fallbackProfile = getChartSettingsForDifficulty(difficulty);
    const densityValue = chartOverrides?.density ?? fallbackProfile.density;
    const laneVarietyValue = chartOverrides?.laneVariety ?? fallbackProfile.laneVariety;
    const sliderProbabilityValue = chartOverrides?.sliderProbability ?? fallbackProfile.sliderProbability;
    const staminaValue = chartOverrides?.stamina ?? fallbackProfile.stamina;

    const bundle = parseChartBundle(storedNotes, difficultyIdForValue(Number(song.difficulty)));
    const charts = toPlayableCharts(bundle);
    const official = pickOfficialChart(charts, difficulty, advancedChartMode && !chartOverrides);

    const generated = await generateChart(audioBuffer, {
      complexity: difficulty,
      density: densityValue,
      laneVariety: laneVarietyValue,
      sliderProbability: sliderProbabilityValue,
      stamina: staminaValue,
      allowMovingSliders: movingSlidersEnabled
    }, { includeNotes: !official, includeSections: true });

    return {
      id: song.id,
      name: song.name,
      artist: song.artist,
      audioBuffer,
      notes: official?.notes ?? generated.notes,
      officialChart: official?.id,
      charts,
      difficulty,
      density: densityValue,
      laneVariety: laneVarietyValue,
      sliderProbability: sliderProbabilityValue,
      stamina: staminaValue,
      sections: generated.sections,
    };
  }, [advancedChartMode, audioContext, complexity, movingSlidersEnabled]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.includes('audio')) {
      setError('Please upload an audio file (MP3, WAV, etc.)');
      return;
    }

    setIsUploading(true);
    setError(null);
    setReadySong(null);
    setLastUploadedFile(file);
    setLastUploadedCover(null);
    setMapTags('');

    try {
      const audioBuffer = await loadAudioFile(file, audioContext);
      const { notes, sections } = await generateChart(audioBuffer, {
        complexity,
        density: effectiveDensity,
        laneVariety: effectiveLaneVariety,
        sliderProbability: effectiveSliderProbability,
        stamina: effectiveStamina,
        allowMovingSliders: movingSlidersEnabled
      }, { includeSections: true });

      const fileName = file.name.replace(/\.[^/.]+$/, "");
      let name = fileName;
      let artist = "Unknown Artist";

      // Try to parse "Artist - Title" format
      if (fileName.includes(" - ")) {
        const parts = fileName.split(" - ");
        artist = parts[0].trim();
        name = parts.slice(1).join(" - ").trim();
      }

      setReadySong({
        name,
        artist,
        audioBuffer,
        notes,
        difficulty: complexity,
        density: effectiveDensity,
        laneVariety: effectiveLaneVariety,
        sliderProbability: effectiveSliderProbability,
        stamina: effectiveStamina,
        sections,
      });
      setMetadata({ name, artist });
    } catch (err) {
      console.error(err);
      setError('Failed to process audio file. Try another one.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleStart = () => {
    if (readySong) {
      onStartGame(readySong);
    }
  };

  const handleSaveToCommunity = async () => {
    if (!readySong || !lastUploadedFile) {
      return;
    }

    if (!metadata.name.trim() || !metadata.artist.trim()) {
      setError('Please enter a song name and artist.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // Every community song ships official Easy-Expert charts so each difficulty has a fair leaderboard.
      const { bundle } = await generateChartBundle(readySong.audioBuffer);
      const defaultPreset = getDifficultyPreset(readySong.difficulty);
      const defaultProfile = getChartSettingsForDifficulty(defaultPreset.value);
      const newSong = await saveCommunitySong({
        audioFile: lastUploadedFile,
        name: metadata.name,
        artist: metadata.artist,
        difficulty: defaultPreset.value,
        density: defaultProfile.density,
        laneVariety: defaultProfile.laneVariety,
        sliderProbability: defaultProfile.sliderProbability,
        stamina: defaultProfile.stamina,
        authorName: username || 'Anonymous',
        notes: bundle,
        coverFile: lastUploadedCover || undefined,
        tags: mapTags.split(',').map((tag) => tag.trim()).filter(Boolean)
      });

      setCommunitySongs(prev => [newSong, ...prev]);
      alert('Song saved to community library!');
    } catch (err: any) {
      console.error('Save error details:', err);
      const message = err?.message || 'Unknown error';
      setError(`Failed to save song: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadCommunitySong = useCallback(async (song: any, difficulty?: number) => {
    try {
      if (difficulty !== undefined) {
        setComplexity(difficulty);
        setAdvancedChartMode(false);
      }
      const songData = await loadStoredSongData(song, difficulty !== undefined ? { difficulty } : undefined);
      setMetadata({ name: song.name, artist: song.artist });
      setMapTags(Array.isArray(song.tags) ? song.tags.join(', ') : '');
      setReadySong(songData);
      setLastMainTab('LOCAL');
      setActiveTab('LOCAL');
    } catch (err) {
      console.error(err);
      setError('Failed to load song audio.');
    }
  }, [loadStoredSongData]);

  const handleLaunchMultiplayer = useCallback(async (room: MultiplayerRoom) => {
    const song = communitySongs.find((entry) => entry.id === room.songId);
    if (!song) {
      throw new Error('The match song is no longer available.');
    }
    setError(null);
    // Everyone in a room plays the same official chart: the one the song was uploaded at.
    const songData = await loadStoredSongData(song, { difficulty: Number(song.difficulty) });
    onStartGame(songData, false, undefined, room);
  }, [communitySongs, loadStoredSongData, onStartGame]);

  const handleLoadReplay = useCallback(async (replay: any) => {
    if (!replay.songId) {
      setError('Cannot load replay for a local song.');
      return;
    }
    try {
      const song = communitySongs.find(s => s.id === replay.songId);
      if (!song) {
        throw new Error('Song not found in community library');
      }

      const songData = await loadStoredSongData(song, {
        difficulty: replay.difficulty,
        density: replay.density ?? replay.difficulty,
        laneVariety: replay.laneVariety ?? replay.difficulty,
        sliderProbability: replay.sliderProbability ?? 0.3,
        stamina: replay.stamina ?? 0.5
      });

      onStartGame({
        ...songData,
        name: replay.songName,
        artist: replay.artist
      }, true, Array.isArray(replay.events) ? replay.events : []);
    } catch (err) {
      console.error(err);
      setError('Failed to load replay audio.');
    }
  }, [communitySongs, loadStoredSongData, onStartGame]);

  useEffect(() => {
    const replayId = sharedReplayIdRef.current;
    if (!replayId || communitySongs.length === 0 || savedReplays.length === 0) return;
    const sharedReplay = savedReplays.find((replay) => replay.id === replayId);
    sharedReplayIdRef.current = null;
    if (!sharedReplay) {
      setError('That shared replay is no longer available.');
      return;
    }
    window.history.replaceState({}, '', window.location.pathname);
    void handleLoadReplay(sharedReplay);
  }, [communitySongs.length, handleLoadReplay, savedReplays]);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdminLoading(true);
    try {
      const token = await loginAdmin(adminPassword);
      setAdminToken(token);
      localStorage.setItem('adminToken', token);
      setAdminPassword('');
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Login failed: ${message}`);
    } finally {
      setIsAdminLoading(false);
    }
  };

  const handleAdminLogout = () => {
    setAdminToken(null);
    localStorage.removeItem('adminToken');
  };

  const handleMainTabChange = useCallback((tab: MainTab) => {
    setLastMainTab(tab);
    setActiveTab(tab);
  }, []);

  const handleOpenAdminPage = useCallback(() => {
    if (activeTab !== 'ADMIN') {
      setLastMainTab(activeTab);
    }
    setActiveTab('ADMIN');
  }, [activeTab]);

  const handleBackToMainPage = useCallback(() => {
    setActiveTab(lastMainTab);
  }, [lastMainTab]);

  const handleChangeAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newAdminPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setIsAdminLoading(true);
    try {
      if (!adminToken) {
        setError('Admin login required.');
        return;
      }
      await changeAdminPassword(adminToken, newAdminPassword);
      setNewAdminPassword('');
      setIsChangingPassword(false);
      setError(null);
      alert('Admin password changed successfully!');
    } catch (err) {
      setError('Failed to change password');
    } finally {
      setIsAdminLoading(false);
    }
  };

  const handleDeleteSong = async (id: string) => {
    setDeleteTargetId(id);
  };

  const confirmDeleteSong = async () => {
    if (!deleteTargetId) return;
    const id = deleteTargetId;
    setDeleteTargetId(null);
    setLoadingSongId(id);
    try {
      if (!adminToken) {
        throw new Error('Admin login required.');
      }
      await deleteCommunitySong(id, adminToken);
      await refreshStoredCollections();
      setCommunitySongs(prev => prev.filter(s => s.id !== id));
      if (readySong?.id === id) {
        setReadySong(null);
        setLastUploadedFile(null);
        setLastUploadedCover(null);
        setMapTags('');
        setMetadata({ name: '', artist: '' });
      }
    } catch (err) {
      console.error(err);
      setError('Failed to delete song');
    } finally {
      setLoadingSongId(null);
    }
  };

  const openLeaderboardRemoval = (score: GlobalScoreRecord) => {
    setLeaderboardRemovalTarget(score);
    setLeaderboardRemovalReason(LEADERBOARD_REMOVAL_REASONS[0]);
  };

  const closeLeaderboardRemoval = () => {
    if (isModeratingLeaderboard) return;
    setLeaderboardRemovalTarget(null);
    setLeaderboardRemovalReason(LEADERBOARD_REMOVAL_REASONS[0]);
  };

  const confirmLeaderboardRemoval = async () => {
    if (!leaderboardRemovalTarget) return;
    if (!adminToken) {
      setError('Admin login required.');
      return;
    }

    const targetUsername = leaderboardRemovalTarget.username;
    const selectedReason = leaderboardRemovalReason;
    setIsModeratingLeaderboard(true);

    try {
      await removeLeaderboardPlayer(adminToken, targetUsername, selectedReason);

      setGlobalScores(prev =>
        prev.filter(score => normalizeUsername(score.username) !== normalizeUsername(targetUsername))
      );
      setCommunitySongs(prev =>
        prev.map(song => {
          const currentScores = Array.isArray(song.scores) ? song.scores : [];
          const nextScores = currentScores.filter(
            (entry: any) => normalizeUsername(entry.username ?? '') !== normalizeUsername(targetUsername)
          );

          if (nextScores.length === currentScores.length) {
            return song;
          }

          return {
            ...song,
            scores: nextScores,
            topScore: getTopScoreFromEntries(nextScores)
          };
        })
      );

      setLeaderboardRemovalTarget(null);
      setLeaderboardRemovalReason(LEADERBOARD_REMOVAL_REASONS[0]);
      setError(null);
      alert(`Removed ${targetUsername} from the leaderboard for "${selectedReason}".`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to remove player from leaderboard');
    } finally {
      setIsModeratingLeaderboard(false);
    }
  };

  const startEditingSong = (song: any) => {
    setEditingSong(song.id);
    setEditForm({ 
      name: song.name, 
      artist: song.artist, 
      difficulty: song.difficulty,
      density: song.density || 0.5,
      laneVariety: song.laneVariety || 0.5,
      sliderProbability: song.sliderProbability || 0.3,
      stamina: song.stamina || 0.5
    } as any);
  };

  const handleUpdateSong = async (id: string) => {
    // Frontend Validation
    if (!editForm.name.trim()) {
      setError('Song name cannot be empty');
      return;
    }
    if (!editForm.artist.trim()) {
      setError('Artist name cannot be empty');
      return;
    }

    setLoadingSongId(id);
    try {
      if (!adminToken) {
        throw new Error('Admin login required.');
      }
      const updatedSong = await updateCommunitySong(id, editForm, adminToken);
      await refreshStoredCollections();
      setCommunitySongs(prev => prev.map(s => s.id === id ? updatedSong : s));
      if (readySong?.id === id) {
        setReadySong(prev => prev ? {
          ...prev,
          name: updatedSong.name,
          artist: updatedSong.artist,
          difficulty: updatedSong.difficulty,
          density: updatedSong.density ?? prev.density,
          laneVariety: updatedSong.laneVariety ?? prev.laneVariety,
          sliderProbability: updatedSong.sliderProbability ?? prev.sliderProbability,
          stamina: updatedSong.stamina ?? prev.stamina
        } : null);
        setMetadata({ name: updatedSong.name, artist: updatedSong.artist });
      }
      setEditingSong(null);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to update song');
    } finally {
      setLoadingSongId(null);
    }
  };

  const runIntegrityCheck = async () => {
    setIsCheckingIntegrity(true);
    setIntegrityResults([]);
    setError(null);
    try {
      const report: IntegrityReport = await getIntegrityReport();
      const hasConfigurationIssues = (report.configurationIssues?.length ?? 0) > 0;
      const results: IntegrityResultRow[] = [
        ...(report.configurationIssues || []).map((issue) => ({
          name: 'Integrity Environment',
          status: 'WARN' as const,
          details: issue,
        })),
        { name: 'Songs Collection', status: hasConfigurationIssues ? 'WARN' as const : 'OK' as const, details: `${report.songsCount} songs found` },
        { name: 'Global Scores Collection', status: hasConfigurationIssues ? 'WARN' as const : 'OK' as const, details: `${report.scoresCount} scores found` },
        { name: 'Replays Collection', status: hasConfigurationIssues ? 'WARN' as const : 'OK' as const, details: `${report.replaysCount} replays found` },
        {
          name: 'Song Storage Files',
          status: report.missingAssetSongsCount > 0 ? 'WARN' as const : 'OK' as const,
          details:
            report.missingAssetSongsCount > 0
              ? `${report.missingAssetSongsCount} songs have missing audio/notes files`
              : 'Song audio + notes files are present for all stored songs',
        },
        {
          name: 'Replay Links',
          status: report.replayLinkIssuesCount > 0 ? 'WARN' as const : 'OK' as const,
          details:
            report.replayLinkIssuesCount > 0
              ? `${report.replayLinkIssuesCount} replays need repair or cleanup`
              : 'Replay records are linked to valid songs',
        },
        {
          name: 'Leaderboard Links',
          status: report.globalScoreLinkIssuesCount > 0 ? 'WARN' as const : 'OK' as const,
          details:
            report.globalScoreLinkIssuesCount > 0
              ? `${report.globalScoreLinkIssuesCount} leaderboard entries need linking or metadata repair`
              : 'Leaderboard entries are linked to valid song metadata',
        },
      ];

      if (report.missingAssetSongsCount > 0) {
        report.missingAssetSongs.forEach((entry) => {
          const missing = [];
          if (entry.missingAudio) missing.push("audio");
          if (entry.missingNotes) missing.push("notes");
          results.push({
            name: `Missing Files: ${entry.name} (${entry.artist})`,
            status: 'ERROR' as const,
            details: `Missing: ${missing.join(", ") || "unknown"}`,
          });
        });
      }

      if (report.replayLinkIssuesCount > 0) {
        report.replayLinkIssues.forEach((issue) => {
          results.push({
            name: `Replay Issue: ${issue.songName} (${issue.artist})`,
            status: issue.issue === 'missing-song' ? 'ERROR' as const : 'WARN' as const,
            details: describeReplayLinkIssue(issue),
          });
        });
      }

      if (report.globalScoreLinkIssuesCount > 0) {
        report.globalScoreLinkIssues.forEach((issue) => {
          results.push({
            name: `Leaderboard Issue: ${issue.songName} (${issue.artist})`,
            status: issue.issue === 'missing-song-link' ? 'WARN' as const : 'ERROR' as const,
            details: describeGlobalScoreLinkIssue(issue),
          });
        });
      }

      setIntegrityResults(results);
    } catch (err: any) {
      console.error("Integrity check failed:", err);
      setError(`Integrity check failed: ${err.message || 'Unknown error'}`);
      setIntegrityResults([{ name: 'Integrity Check', status: 'ERROR' as const, details: err.message || 'Unknown error' }]);
    } finally {
      setIsCheckingIntegrity(false);
    }
  };

  const outdatedChartSongs = communitySongs.filter((song) => (Number(song.chartVersion) || 1) < CURRENT_CHART_VERSION);

  // Rebuilds official charts for songs made with an older generator. Runs in the admin's
  // browser (charting needs the decoded audio) and uploads each finished bundle.
  const handleRebuildOutdatedCharts = async () => {
    if (!adminToken) {
      setError('Admin login required.');
      return;
    }
    if (outdatedChartSongs.length === 0) return;
    if (!confirm(`Rebuild charts for ${outdatedChartSongs.length} song(s)? Scores set on the old charts stay visible as legacy entries, and replays of the old charts may no longer line up.`)) return;
    setError(null);
    const failures: string[] = [];
    for (const [index, song] of outdatedChartSongs.entries()) {
      setChartRebuildStatus(`Rebuilding ${index + 1}/${outdatedChartSongs.length}: ${song.name}`);
      try {
        const audio = await fetchSongAsset(song.audioUrl).then((response) => response.arrayBuffer());
        const audioBuffer = await audioContext.decodeAudioData(audio);
        const { bundle } = await generateChartBundle(audioBuffer);
        const updated = await replaceSongCharts(song.id, bundle, adminToken);
        setCommunitySongs((previous) => previous.map((entry) => entry.id === song.id ? { ...entry, ...updated } : entry));
      } catch (err) {
        console.error(`Failed to rebuild charts for ${song.name}:`, err);
        failures.push(song.name);
      }
    }
    setChartRebuildStatus(null);
    alert(failures.length ? `Rebuilt charts, but these failed: ${failures.join(', ')}` : 'All outdated charts were rebuilt.');
  };

  const handleForceStorageUpdate = async () => {
    if (!adminToken) {
      setError('Admin login required.');
      return;
    }

    setIsForcingStorageUpdate(true);
    setError(null);

    try {
      const result = await forceStorageUpdate(adminToken);
      await refreshStoredCollections();
      await runIntegrityCheck();

      const rewrittenMessage =
        result.rewrittenCollections && result.rewrittenCollections.length > 0
          ? ` Rewrote: ${result.rewrittenCollections.join(', ')}.`
          : '';
      const relationshipMessage = result.relationshipActions
        ? ` Linked ${result.relationshipActions.linkedGlobalScores} leaderboard rows and ${result.relationshipActions.linkedReplays} replays. Repaired ${result.relationshipActions.updatedGlobalScoreMetadata} leaderboard labels and ${result.relationshipActions.updatedReplayMetadata} replay labels. Removed ${result.relationshipActions.removedOrphanReplays} orphan replays.`
        : '';

      alert(
        `Forced update complete. Normalized ${result.normalizedRows.songs} songs, ${result.normalizedRows.globalScores} leaderboard entries, and ${result.normalizedRows.replays} replays.${rewrittenMessage}${relationshipMessage}`
      );
    } catch (err: any) {
      console.error('Forced storage update failed:', err);
      setError(err.message || 'Failed to force storage update');
    } finally {
      setIsForcingStorageUpdate(false);
    }
  };

  const fetchMoreGlobalScores = async () => {
    if (isLoadingMoreScores || !hasMoreScores) return;

    setIsLoadingMoreScores(true);
    try {
      const { scores, nextOffset } = await getGlobalScores({ limit: 100, offset: globalScoresOffset });
      setGlobalScores(prev => [...prev, ...scores]);
      setGlobalScoresOffset(nextOffset || 0);
      setHasMoreScores(nextOffset !== null);
    } catch (err) {
      console.error('Failed to fetch more global scores:', err);
    } finally {
      setIsLoadingMoreScores(false);
    }
  };

  const handleGlobalScoresScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
    if (isAtBottom) {
      fetchMoreGlobalScores();
    }
  };

  const handlePreviewStart = (audioUrl: string) => {
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    
    previewTimeoutRef.current = setTimeout(() => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.src = "";
      }
      
      // <audio> needs no CORS, so previews stream straight from storage instead of through the API.
      const audio = new Audio(audioUrl);
      audio.volume = settings.volume * 0.5;
      
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          if (err.name !== 'AbortError') {
            console.error("Preview failed:", err);
          }
        });
      }
      previewAudioRef.current = audio;
    }, 400);
  };

  const handlePreviewStop = () => {
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = "";
      previewAudioRef.current.load(); // Force reset
      previewAudioRef.current = null;
    }
  };

  useEffect(() => {
    handlePreviewStop();
  }, [activeTab]);

  useEffect(() => {
    return () => handlePreviewStop();
  }, []);

  return (
    <div className={`min-h-screen w-full flex flex-col items-center justify-start md:justify-center p-6 md:p-12 relative overflow-x-hidden ${localSettings.menuTheme === 'aurora' ? 'bg-[#080512]' : 'bg-black'}`}>
      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-neon-blue/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-neon-purple/10 blur-[120px] rounded-full" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="z-10 flex flex-col items-center max-w-6xl w-full"
      >
        <div className="mb-12 text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
            className="inline-block mb-4"
          >
            <Disc className="w-16 h-16 text-neon-blue" />
          </motion.div>
          <h1 className="mb-2 font-display text-5xl font-black uppercase italic tracking-tighter sm:text-7xl md:text-8xl">
            Beat<span className="text-neon-pink">Pulse</span>
          </h1>
          <p className="text-white/40 font-display font-bold tracking-[0.3em] uppercase text-sm">
            Rhythm Evolution
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.18em] text-white/35">
            <span className="rounded-full border border-neon-green/20 bg-neon-green/[0.07] px-3 py-1.5"><span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-neon-green shadow-[0_0_8px_#39ff14]" />Live multiplayer</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">Auto charts</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">Up to 8 players</span>
          </div>
        </div>

        {/* Top Utility Buttons */}
        <div className="mb-6 flex w-full items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 sm:gap-3 sm:px-4">
            <div className="w-5 h-5 rounded-full bg-neon-purple/20 flex items-center justify-center">
              <User className="w-3 h-3 text-neon-purple" />
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <span className="max-w-[100px] truncate text-[10px] font-bold uppercase tracking-widest text-white/60 sm:max-w-[140px]">
                {username || 'Anonymous'}
              </span>
              <span className="shrink-0 rounded-md border border-neon-blue/30 bg-neon-blue/10 px-1.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-wider text-neon-blue">
                Lvl {progress.level}
              </span>
              <span className="hidden truncate text-[9px] font-bold uppercase tracking-[0.14em] text-neon-purple md:inline">
                {getSeasonTier(progress)}
              </span>
            </div>
            <button
              onClick={() => handleMainTabChange('SOCIAL')}
              aria-label="Open Social"
              className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 font-display text-[9px] font-bold uppercase tracking-wider transition-all sm:px-3 ${
                activeTab === 'SOCIAL'
                  ? 'border-neon-purple bg-neon-purple text-black shadow-[0_0_14px_rgba(168,85,247,0.28)]'
                  : 'border-neon-purple/30 bg-neon-purple/10 text-neon-purple hover:border-neon-purple/60 hover:bg-neon-purple/20'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>Social</span>
            </button>
          </div>
          {isAdminPage ? (
            <button
              onClick={handleBackToMainPage}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border bg-white/5 text-white border-white/10 hover:bg-white/10 transition-all font-display font-bold text-xs uppercase tracking-widest"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <div className="flex shrink-0 gap-2 sm:gap-3">
              <button 
                onClick={handleOpenAdminPage}
                aria-label="Open admin panel"
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-display text-xs font-bold uppercase tracking-widest text-white/40 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white sm:px-4"
              >
                <Lock className="w-4 h-4" />
                <span className="hidden sm:inline">Admin</span>
              </button>
              <button 
                onClick={() => handleMainTabChange('SETTINGS')}
                aria-label="Open player settings"
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 font-display text-xs font-bold uppercase tracking-widest transition-all sm:px-4 ${
                  activeTab === 'SETTINGS' 
                    ? 'bg-neon-blue text-black border-neon-blue shadow-[0_0_15px_rgba(0,243,255,0.3)]' 
                    : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20'
                }`}
              >
                <SettingsIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Settings</span>
              </button>
            </div>
          )}
        </div>

        <div className={`grid gap-6 w-full ${isAdminPage ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
          {!isAdminPage && activeTab === 'LOCAL' && (
            <>
          {/* Upload Card */}
          <div className="relative">
            {!readySong ? (
              <label className="group relative overflow-hidden rounded-3xl bg-white/5 border border-white/10 p-8 flex flex-col items-center justify-center cursor-pointer transition-all hover:bg-white/10 hover:border-neon-blue/50 h-full min-h-[240px]">
                <input 
                  type="file" 
                  accept="audio/*" 
                  className="hidden" 
                  onChange={handleFileUpload}
                  disabled={isUploading}
                />
                
                <div className="mb-4 p-4 rounded-2xl bg-neon-blue/10 text-neon-blue group-hover:scale-110 transition-transform">
                  <Upload className="w-8 h-8" />
                </div>
                
                <h3 className="text-xl font-display font-bold mb-1">Upload Song</h3>
                <p className="text-white/40 text-sm text-center">
                  MP3, WAV, or OGG. We'll auto-generate the beats.
                </p>

                {isUploading && (
                  <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center backdrop-blur-sm">
                    <div className="w-12 h-12 border-4 border-neon-blue border-t-transparent rounded-full animate-spin mb-4" />
                    <p className="font-display font-bold text-neon-blue animate-pulse">ANALYZING BEATS...</p>
                  </div>
                )}
              </label>
            ) : (
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="rounded-3xl bg-neon-blue/10 border border-neon-blue/50 p-8 flex flex-col items-center justify-center h-full min-h-[240px]"
              >
                <div className="mb-4 p-4 rounded-2xl bg-neon-blue text-black">
                  <Music className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-display font-bold mb-1 text-neon-blue truncate w-full text-center">
                  {metadata.name}
                </h3>
                <p className="text-white/40 text-sm mb-6">
                  {isRegenerating ? 'Recalculating beats...' : 'Ready to play!'}
                </p>

                <div className="w-full space-y-3 mb-6">
                  <input 
                    type="text"
                    value={metadata.name}
                    onChange={(e) => setMetadata(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-sm focus:border-neon-blue outline-none"
                    placeholder="Song Name"
                  />
                  <input 
                    type="text"
                    value={metadata.artist}
                    onChange={(e) => setMetadata(prev => ({ ...prev, artist: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-sm focus:border-neon-blue outline-none"
                    placeholder="Artist"
                  />
                  <label className="block rounded-xl border border-dashed border-white/15 bg-black/15 px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-white/40 transition hover:border-neon-purple/45 hover:text-neon-purple">
                    <span>{lastUploadedCover ? `Cover ready: ${lastUploadedCover.name}` : 'Optional cover art (PNG, JPG, WebP)'}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="mt-2 block w-full text-xs normal-case tracking-normal text-white/55 file:mr-3 file:rounded-lg file:border-0 file:bg-neon-purple/15 file:px-2 file:py-1.5 file:text-[10px] file:font-bold file:text-neon-purple" onChange={(event) => setLastUploadedCover(event.target.files?.[0] || null)} />
                  </label>
                  <input
                    type="text"
                    value={mapTags}
                    onChange={(event) => setMapTags(event.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-sm focus:border-neon-blue outline-none"
                    placeholder="Tags (e.g. pop, fast, practice)"
                  />
                </div>
                
                <div className="mb-4 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Difficulty">
                  {DIFFICULTY_PRESETS.map((preset) => {
                    const selected = !advancedChartMode && difficultyPreset.id === preset.id;
                    const record = songRecords.find((entry) => entry.preset.id === preset.id)?.record;
                    const hasOfficial = !readySong.id || Boolean(readySong.charts?.[preset.id]?.length);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => selectDifficultyPreset(preset.value)}
                        title={readySong.id && !hasOfficial ? 'No official chart yet: this difficulty is generated locally and unranked' : preset.description}
                        className={`rounded-xl border px-2 py-2 text-center transition ${selected ? 'border-neon-blue bg-neon-blue/15 text-white' : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white'}`}
                      >
                        <span className="block text-[10px] font-black uppercase tracking-wider">{preset.label}</span>
                        <span className="mt-0.5 block text-[9px] font-bold text-white/40">{record ? `${record.bestRank}${record.fullCombo ? ' · FC' : ''}` : hasOfficial ? '—' : 'local'}</span>
                      </button>
                    );
                  })}
                </div>

                <p className="text-neon-blue/60 text-[10px] font-bold uppercase tracking-widest mb-6">
                  {isRegenerating ? '---' : `${readySong.notes.length} Notes Detected`}
                  {readySong.id && !isRegenerating && (
                    <span className={readySong.officialChart ? 'text-neon-green/70' : 'text-neon-orange/80'}>
                      {readySong.officialChart ? ' · Ranked chart' : ' · Unranked custom chart'}
                    </span>
                  )}
                </p>
                
                <button 
                  onClick={handleStart}
                  disabled={isRegenerating}
                  className={`w-full py-4 rounded-2xl font-display font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(0,243,255,0.3)] ${
                    isRegenerating 
                      ? 'bg-white/10 text-white/20 cursor-not-allowed shadow-none' 
                      : 'bg-neon-blue text-black hover:bg-white'
                  }`}
                >
                  {isRegenerating ? (
                    <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Play className="w-5 h-5 fill-current" />
                  )}
                  {isRegenerating ? 'Updating...' : 'Start Game'}
                </button>

                <button
                  onClick={() => setIsEditingChart(true)}
                  disabled={isRegenerating}
                  className="mt-3 w-full rounded-xl border border-neon-orange/30 bg-neon-orange/10 py-3 font-display text-xs font-bold uppercase tracking-widest text-neon-orange transition hover:bg-neon-orange hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="flex items-center justify-center gap-2"><Edit2 className="h-4 w-4" /> Edit beatmap</span>
                </button>

                {lastUploadedFile && (
                  <button 
                    onClick={handleSaveToCommunity}
                    disabled={isSaving || isRegenerating}
                    className="mt-3 w-full py-3 rounded-xl border border-neon-purple/30 text-neon-purple font-display font-bold uppercase tracking-widest text-xs hover:bg-neon-purple/10 transition-all flex items-center justify-center gap-2"
                  >
                    {isSaving ? (
                      <div className="w-4 h-4 border-2 border-neon-purple/20 border-t-neon-purple rounded-full animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {isSaving ? 'Saving...' : 'Save to Community'}
                  </button>
                )}
                
                <button 
                  onClick={() => setReadySong(null)}
                  className="mt-4 text-xs font-bold text-white/30 hover:text-white transition-colors uppercase tracking-widest"
                >
                  Choose Different Song
                </button>
              </motion.div>
            )}
          </div>

          {/* Info Card */}
          <div className="rounded-3xl bg-white/5 border border-white/10 p-8 flex flex-col justify-between">
            <div>
              <DailyChallengeCard songs={communitySongs} onPlay={handleLoadCommunitySong} />
              <h3 className="text-xl font-display font-bold mb-4 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-neon-pink" />
                How to Play
              </h3>
              <ul className="space-y-3 text-white/60 text-sm font-medium">
                <li className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white font-bold">D</span>
                  Lane 1
                </li>
                <li className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white font-bold">F</span>
                  Lane 2
                </li>
                <li className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white font-bold">J</span>
                  Lane 3
                </li>
                <li className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white font-bold">K</span>
                  Lane 4
                </li>
              </ul>
            </div>
            
            <div className="mt-6 pt-6 border-t border-white/5">
              <p className="text-xs text-white/30 italic">
                {movingSlidersEnabled
                  ? 'Tap at the line. Hold trails, follow curved slides across lanes, and release on the tail.'
                  : 'Tap at the line. Hold straight trails in their lane and release on the tail.'}
              </p>
            </div>
          </div>
            </>
          )}

          {/* Community Library Card */}
          <div className="md:col-span-2 rounded-[2rem] bg-black/40 backdrop-blur-xl border border-white/10 p-4 md:p-8 flex flex-col shadow-2xl relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent ${isAdminPage ? 'via-neon-pink/50' : 'via-neon-blue/50'} to-transparent`} />
            
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className={`absolute inset-0 ${isAdminPage ? 'bg-neon-pink' : 'bg-neon-blue'} blur-lg opacity-20 animate-pulse`} />
                  <div className={`relative p-3 rounded-2xl border ${isAdminPage ? 'bg-neon-pink/10 border-neon-pink/20 text-neon-pink' : 'bg-neon-blue/10 border-neon-blue/20 text-neon-blue'}`}>
                    {isAdminPage ? <Lock className="w-6 h-6" /> : <SectionIcon className="w-6 h-6" />}
                  </div>
                </div>
                <div>
                  {isAdminPage ? (
                    <>
                      <h3 className="text-2xl font-display font-black uppercase tracking-tight italic">
                        Admin <span className="text-neon-pink">Panel</span>
                      </h3>
                      <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-bold">Restricted Control Surface</p>
                    </>
                  ) : (
                    <>
                      <h3 className="text-2xl font-display font-black uppercase tracking-tight italic">
                        {sectionMeta.lead} <span className={sectionMeta.color}>{sectionMeta.accent}</span>
                      </h3>
                      <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-bold">{sectionMeta.subtitle}</p>
                    </>
                  )}
                </div>
              </div>

              {!isAdminPage && (
              <div className="flex max-w-full overflow-x-auto no-scrollbar bg-white/5 backdrop-blur-md rounded-2xl p-1.5 border border-white/5 self-start lg:self-center">
                {[
                  { id: 'LOCAL', label: 'Local', icon: <Activity className="w-3.5 h-3.5" /> },
                  { id: 'COMMUNITY', label: 'Community', icon: <Cloud className="w-3.5 h-3.5" /> },
                  { id: 'SOCIAL', label: 'Social', icon: <Users className="w-3.5 h-3.5" /> },
                  { id: 'PROGRESS', label: 'Progress', icon: <Trophy className="w-3.5 h-3.5" /> },
                  { id: 'GLOBAL', label: 'Global Scores', icon: <Trophy className="w-3.5 h-3.5" /> },
                  { id: 'REPLAYS', label: 'Replays', icon: <Play className="w-3.5 h-3.5" /> }
                ].map((tab) => (
                  <button 
                    key={tab.id}
                    onClick={() => handleMainTabChange(tab.id as MainTab)}
                    className={`relative px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center gap-2 group ${
                      activeTab === tab.id ? 'text-black' : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    {activeTab === tab.id && (
                      <motion.div 
                        layoutId="activeTab"
                        className="absolute inset-0 bg-white rounded-xl shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                      />
                    )}
                    <span className="relative z-10">{tab.icon}</span>
                    <span className="relative z-10 whitespace-nowrap">{tab.label}</span>
                  </button>
                ))}
              </div>
              )}
            </div>
            
            <Suspense fallback={<PanelFallback />}>
            {activeTab === 'SOCIAL' ? (
              <SocialHub
                identity={playerIdentity}
                songs={communitySongs}
                onLaunchMatch={handleLaunchMultiplayer}
              />
            ) : activeTab === 'PROGRESS' ? (
              <ProgressionHub
                progress={progress}
                settings={localSettings}
                onSaveSettings={(nextSettings) => {
                  setLocalSettings(nextSettings);
                  onSaveSettings(nextSettings);
                }}
                onProgressUpdate={onUpdateProgress}
              />
            ) : activeTab === 'COMMUNITY' ? (
              <SongLibrary
                songs={communitySongs}
                favoriteSongIds={progress.favoriteSongIds}
                onToggleFavorite={handleToggleFavorite}
                onLoadSong={handleLoadCommunitySong}
                onPreviewStart={handlePreviewStart}
                onPreviewStop={handlePreviewStop}
              />
            ) : activeTab === 'GLOBAL' ? (
              globalScores.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-white/20 border-2 border-dashed border-white/5 rounded-2xl">
                  <Trophy className="w-12 h-12 mb-4 opacity-10" />
                  <p className="text-sm font-bold uppercase tracking-widest">No scores yet</p>
                  <p className="text-xs mt-1">Play a song to set the first high score!</p>
                </div>
              ) : (
                <div 
                  onScroll={handleGlobalScoresScroll}
                  className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar touch-pan-y"
                >
                  {globalScores.map((score, idx) => (
                    <div 
                      key={idx} 
                      className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5"
                    >
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-xs text-white/40">{idx + 1 < 10 ? `0${idx + 1}` : idx + 1}</span>
                        <div>
                          <div className="text-white font-bold">{score.score.toLocaleString()}</div>
                          <div className="text-[10px] text-white/40 uppercase tracking-tighter">{score.username} - {score.songName}</div>
                          {score.fullCombo && <div className="mt-1 inline-flex rounded-full border border-neon-orange/35 bg-neon-orange/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-neon-orange">Full Combo</div>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-neon-green font-mono text-sm">{score.accuracy.toFixed(1)}%</div>
                        <div className="text-[10px] text-white/40 uppercase tracking-tighter">{score.date}</div>
                      </div>
                    </div>
                  ))}
                  {isLoadingMoreScores && (
                    <div className="flex justify-center py-4">
                      <div className="w-6 h-6 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              )
            ) : activeTab === 'REPLAYS' ? (
              savedReplays.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-white/20 border-2 border-dashed border-white/5 rounded-2xl">
                  <Play className="w-12 h-12 mb-4 opacity-10" />
                  <p className="text-sm font-bold uppercase tracking-widest">No saved replays</p>
                  <p className="text-xs mt-1">Play a community song and save your replay at the end!</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar touch-pan-y">
                  {savedReplays.map((replay, idx) => (
                    <div 
                      key={replay.id || idx} 
                      className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5"
                    >
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-xs text-white/40">0{idx + 1}</span>
                        <div>
                          <div className="text-white font-bold">{replay.songName}</div>
                          <div className="text-[10px] text-white/40 uppercase tracking-tighter">{replay.artist} - {replay.date}</div>
                          {replay.judgements && <div className="mt-1 text-[9px] font-bold uppercase tracking-wider text-neon-purple">{replay.judgements.perfect || 0} perfect · {replay.judgements.great || 0} great · {replay.judgements.miss || 0} miss</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <div className="text-neon-blue font-mono text-sm">{replay.score.toLocaleString()}</div>
                          <div className="text-neon-green font-mono text-[10px]">{replay.accuracy.toFixed(1)}%</div>
                        </div>
                        <button 
                          onClick={() => handleLoadReplay(replay)}
                          disabled={!replay.songId}
                          className={`p-3 rounded-xl transition-all ${replay.songId ? 'bg-neon-blue/20 text-neon-blue hover:bg-neon-blue hover:text-black' : 'bg-white/5 text-white/20 cursor-not-allowed'}`}
                          title={!replay.songId ? "Cannot replay local songs" : "Watch Replay"}
                        >
                          <Play className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : activeTab === 'ADMIN' ? (
              <AdminPanel
                adminPassword={adminPassword}
                adminToken={adminToken}
                chartRebuildStatus={chartRebuildStatus}
                communitySongs={communitySongs}
                editForm={editForm}
                editingSong={editingSong}
                fetchMoreGlobalScores={fetchMoreGlobalScores}
                globalScores={globalScores}
                handleAdminLogin={handleAdminLogin}
                handleAdminLogout={handleAdminLogout}
                handleChangeAdminPassword={handleChangeAdminPassword}
                handleDeleteSong={handleDeleteSong}
                handleForceStorageUpdate={handleForceStorageUpdate}
                handleMainTabChange={handleMainTabChange}
                handleRebuildOutdatedCharts={handleRebuildOutdatedCharts}
                handleUpdateSong={handleUpdateSong}
                hasMoreScores={hasMoreScores}
                integrityResults={integrityResults}
                isAdminLoading={isAdminLoading}
                isChangingPassword={isChangingPassword}
                isCheckingIntegrity={isCheckingIntegrity}
                isForcingStorageUpdate={isForcingStorageUpdate}
                isLoadingMoreScores={isLoadingMoreScores}
                isModeratingLeaderboard={isModeratingLeaderboard}
                loadingSongId={loadingSongId}
                newAdminPassword={newAdminPassword}
                openLeaderboardRemoval={openLeaderboardRemoval}
                outdatedChartSongs={outdatedChartSongs}
                runIntegrityCheck={runIntegrityCheck}
                setAdminPassword={setAdminPassword}
                setEditForm={setEditForm}
                setEditingSong={setEditingSong}
                setIntegrityResults={setIntegrityResults}
                setIsChangingPassword={setIsChangingPassword}
                setNewAdminPassword={setNewAdminPassword}
                startEditingSong={startEditingSong}
              />
            ) : activeTab === 'SETTINGS' ? (
              <SettingsPanel
                activeKeybindIndex={activeKeybindIndex}
                advancedChartMode={advancedChartMode}
                advancedControls={advancedControls}
                audioContext={audioContext}
                chartProfileRows={chartProfileRows}
                complexity={complexity}
                difficultyPreset={difficultyPreset}
                gameplayOptions={gameplayOptions}
                handleProfileLoadout={handleProfileLoadout}
                keybindingPrompt={keybindingPrompt}
                localSettings={localSettings}
                onSaveSettings={onSaveSettings}
                progress={progress}
                resetChartSettings={resetChartSettings}
                selectDifficultyPreset={selectDifficultyPreset}
                setActiveKeybindIndex={setActiveKeybindIndex}
                setComplexity={setComplexity}
                setLocalSettings={setLocalSettings}
                setUsername={setUsername}
                toggleAdvancedChartMode={toggleAdvancedChartMode}
                upcomingLevelRewards={upcomingLevelRewards}
                updateGameplayOptions={updateGameplayOptions}
                username={username}
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-neon-blue/15 bg-neon-blue/[0.05] p-5">
                  <span className="font-mono text-xs font-bold text-neon-blue">01</span>
                  <h4 className="mt-3 font-display font-bold">Bring your music</h4>
                  <p className="mt-2 text-xs leading-relaxed text-white/40">Drop an audio file into the Play Studio above. BeatPulse builds the chart locally in your browser.</p>
                </div>
                <button onClick={() => handleMainTabChange('COMMUNITY')} className="rounded-2xl border border-neon-purple/15 bg-neon-purple/[0.05] p-5 text-left transition hover:border-neon-purple/35 hover:bg-neon-purple/10">
                  <span className="font-mono text-xs font-bold text-neon-purple">02</span>
                  <h4 className="mt-3 font-display font-bold">Explore charts</h4>
                  <p className="mt-2 text-xs leading-relaxed text-white/40">Load a community song, preview its audio, and chase the top five scores.</p>
                </button>
                <button onClick={() => handleMainTabChange('SOCIAL')} className="rounded-2xl border border-neon-green/15 bg-neon-green/[0.05] p-5 text-left transition hover:border-neon-green/35 hover:bg-neon-green/10">
                  <span className="font-mono text-xs font-bold text-neon-green">03</span>
                  <h4 className="mt-3 font-display font-bold">Race your crew</h4>
                  <p className="mt-2 text-xs leading-relaxed text-white/40">Add friends, open a live room, ready up, and watch standings move in real time.</p>
                </button>
              </div>
            )}
            </Suspense>
          </div>
        </div>

        {error && (
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 text-neon-pink font-display font-bold text-sm"
          >
            {error}
          </motion.p>
        )}

        <div className="mt-16 flex items-center gap-8 text-white/20">
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-widest">HTML5 AUDIO</span>
          </div>
          <div className="w-1 h-1 bg-white/20 rounded-full" />
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-widest">REALTIME SYNC</span>
          </div>
        </div>
      </motion.div>

      {isEditingChart && readySong && (
        <Suspense fallback={null}>
        <BeatmapEditor
          song={readySong}
          audioContext={audioContext}
          volume={localSettings.volume}
          onNotesChange={handleChartNotesChange}
          onTestChart={() => {
            handlePreviewStop();
            setIsEditingChart(false);
            onStartGame(readySong);
          }}
          onClose={() => setIsEditingChart(false)}
        />
        </Suspense>
      )}

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteTargetId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeleteTargetId(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-sm bg-zinc-900 border border-white/10 rounded-[32px] p-8 shadow-2xl"
            >
              <h3 className="text-xl font-display font-black text-white mb-4">Delete Song?</h3>
              <p className="text-white/60 text-sm mb-8">This action cannot be undone. This will also remove linked replays and leaderboard data for this community song.</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setDeleteTargetId(null)}
                  className="flex-1 py-3 rounded-2xl bg-white/5 text-white font-bold hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmDeleteSong}
                  className="flex-1 py-3 rounded-2xl bg-neon-pink text-white font-bold hover:bg-neon-pink/80 transition-all"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {leaderboardRemovalTarget && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeLeaderboardRemoval}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-zinc-900 border border-white/10 rounded-[32px] p-8 shadow-2xl"
            >
              <h3 className="text-xl font-display font-black text-white mb-3">Remove Player?</h3>
              <p className="text-white/60 text-sm mb-6">
                This removes <span className="text-white font-bold">{leaderboardRemovalTarget.username}</span> from the global leaderboard and matching song leaderboards.
              </p>

              <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">
                Removal Reason
              </label>
              <select
                value={leaderboardRemovalReason}
                onChange={(e) => setLeaderboardRemovalReason(e.target.value)}
                disabled={isModeratingLeaderboard}
                className="w-full bg-black/50 border border-white/20 rounded-xl p-3 text-sm text-white focus:border-neon-pink outline-none mb-8"
              >
                {LEADERBOARD_REMOVAL_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>

              <div className="flex gap-4">
                <button
                  onClick={closeLeaderboardRemoval}
                  disabled={isModeratingLeaderboard}
                  className="flex-1 py-3 rounded-2xl bg-white/5 text-white font-bold hover:bg-white/10 transition-all disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmLeaderboardRemoval}
                  disabled={isModeratingLeaderboard}
                  className={`flex-1 py-3 rounded-2xl font-bold transition-all ${
                    isModeratingLeaderboard
                      ? 'bg-white/10 text-white/40 cursor-not-allowed'
                      : 'bg-neon-pink text-white hover:bg-neon-pink/80'
                  }`}
                >
                  {isModeratingLeaderboard ? 'Removing...' : 'Remove Player'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};
