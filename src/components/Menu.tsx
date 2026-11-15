import React, { lazy, Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useMemo } from 'react';
import {
  Music,
  Play,
  Trophy,
  Save,
  Edit2,
  Check,
  X
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
import { AppShell, PageHeader, type ShellTab } from './shell/AppShell';
import { Card, ControlsCard, DifficultyPicker, RecentRunsCard, SongDropZone } from './play/PlayCards';
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

  const handleAudioFile = async (file: File) => {
    // Dropped files sometimes arrive without a MIME type, so the extension counts too.
    if (!file.type.includes('audio') && !/\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i.test(file.name)) {
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

  const pageCopy: Record<ShellTab, { title: string; subtitle: string }> = {
    LOCAL: readySong
      ? { title: 'Ready to play', subtitle: 'Pick a difficulty and start, or fine-tune the chart first.' }
      : { title: 'Play', subtitle: 'Drop in any song and BeatPulse builds a chart for it in seconds.' },
    COMMUNITY: { title: 'Library', subtitle: 'Songs shared by players, each with Easy to Expert charts.' },
    SOCIAL: { title: 'Social', subtitle: 'Friends, messages and live matches.' },
    PROGRESS: { title: 'Progress', subtitle: 'Missions, rewards, the shop and your season rank.' },
    GLOBAL: { title: 'Leaderboards', subtitle: 'The best runs across every chart.' },
    REPLAYS: { title: 'Replays', subtitle: 'Rewatch and study saved runs.' },
    SETTINGS: { title: 'Settings', subtitle: 'Controls, chart generation, visuals and sound.' },
    ADMIN: { title: 'Admin', subtitle: 'Manage songs, scores and storage.' },
  };
  const handleShellNavigate = (tab: ShellTab) => (tab === 'ADMIN' ? handleOpenAdminPage() : handleMainTabChange(tab));
  const isPublishableUpload = Boolean(readySong && !readySong.id && lastUploadedFile);
  const officialChartIds = readySong?.id
    ? new Set(DIFFICULTY_PRESETS.filter((preset) => readySong.charts?.[preset.id]?.length).map((preset) => preset.id))
    : undefined;

  const playPage = (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        {!readySong ? (
          <>
            <SongDropZone isUploading={isUploading} onFile={(file) => void handleAudioFile(file)} onBrowseLibrary={() => handleMainTabChange('COMMUNITY')} />
            <div className="hidden gap-3 sm:grid sm:grid-cols-3">
              {[
                { step: '1', title: 'Add a song', body: 'Drop any track. The chart is generated on your device.' },
                { step: '2', title: 'Pick a difficulty', body: 'Easy to Expert, each with its own personal best.' },
                { step: '3', title: 'Share it', body: 'Publish to the library so friends can race your chart.' },
              ].map((entry) => (
                <div key={entry.step} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 font-mono text-xs font-bold text-white/70">{entry.step}</span>
                  <p className="mt-3 text-sm font-semibold text-white">{entry.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/45">{entry.body}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <Card>
              <div className="flex items-start gap-4">
                <span className="shrink-0 rounded-2xl bg-neon-blue p-3 text-black"><Music className="h-7 w-7" /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-display text-2xl font-bold text-white">{readySong.id ? readySong.name : metadata.name || readySong.name}</h2>
                  <p className="truncate text-sm text-white/50">{readySong.id ? readySong.artist : metadata.artist || readySong.artist}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                    {readySong.id ? (
                      <span className={`rounded-full px-2 py-0.5 ${readySong.officialChart ? 'bg-neon-green/10 text-neon-green' : 'bg-neon-orange/10 text-neon-orange'}`}>
                        {readySong.officialChart ? 'Ranked chart' : 'Unranked custom chart'}
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/60">Your upload</span>
                    )}
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/60">{isRegenerating ? 'Charting…' : `${readySong.notes.length} notes`}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/60">{Math.floor(readySong.audioBuffer.duration / 60)}:{String(Math.round(readySong.audioBuffer.duration % 60)).padStart(2, '0')}</span>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white/80">Difficulty</h3>
                  {advancedChartMode
                    ? <button type="button" onClick={() => handleMainTabChange('SETTINGS')} className="text-xs font-semibold text-neon-orange hover:text-white">Custom chart settings on</button>
                    : <span className="text-xs text-white/40">{difficultyPreset.description}</span>}
                </div>
                <DifficultyPicker
                  presets={DIFFICULTY_PRESETS}
                  selectedId={advancedChartMode ? null : difficultyPreset.id}
                  records={songRecords}
                  officialIds={officialChartIds}
                  onSelect={selectDifficultyPreset}
                />
              </div>

              <button
                type="button"
                onClick={handleStart}
                disabled={isRegenerating}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-neon-blue py-4 font-display text-lg font-black uppercase tracking-wider text-black shadow-[0_0_24px_rgba(0,243,255,0.25)] transition hover:bg-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30 disabled:shadow-none"
              >
                {isRegenerating ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" /> : <Play className="h-5 w-5 fill-current" />}
                {isRegenerating ? 'Updating chart…' : 'Start'}
              </button>
              <div className={`mt-3 grid gap-2 ${isPublishableUpload ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                <button type="button" onClick={() => setIsEditingChart(true)} disabled={isRegenerating} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 py-2.5 text-sm font-semibold text-white/70 transition hover:border-white/25 hover:text-white disabled:opacity-40">
                  <Edit2 className="h-4 w-4" /> Edit chart
                </button>
                {isPublishableUpload && (
                  <button type="button" onClick={handleSaveToCommunity} disabled={isSaving || isRegenerating} className="flex items-center justify-center gap-2 rounded-xl border border-neon-purple/35 py-2.5 text-sm font-semibold text-neon-purple transition hover:bg-neon-purple/10 disabled:opacity-40">
                    {isSaving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-neon-purple/20 border-t-neon-purple" /> : <Save className="h-4 w-4" />}
                    {isSaving ? 'Saving...' : 'Save to Community'}
                  </button>
                )}
                <button type="button" onClick={() => setReadySong(null)} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 py-2.5 text-sm font-semibold text-white/70 transition hover:border-white/25 hover:text-white">
                  <X className="h-4 w-4" /> Change song
                </button>
              </div>
            </Card>

            {isPublishableUpload && (
              <Card title="Song details" icon={Edit2}>
                <p className="-mt-2 mb-4 text-xs text-white/40">Used when you publish to the library.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-white/55">Title
                    <input type="text" value={metadata.name} onChange={(e) => setMetadata(prev => ({ ...prev, name: e.target.value }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-neon-blue" placeholder="Song name" />
                  </label>
                  <label className="text-xs font-medium text-white/55">Artist
                    <input type="text" value={metadata.artist} onChange={(e) => setMetadata(prev => ({ ...prev, artist: e.target.value }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-neon-blue" placeholder="Artist" />
                  </label>
                  <label className="text-xs font-medium text-white/55">Tags
                    <input type="text" value={mapTags} onChange={(event) => setMapTags(event.target.value)} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-neon-blue" placeholder="pop, fast, practice" />
                  </label>
                  <label className="text-xs font-medium text-white/55">Cover art (optional)
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setLastUploadedCover(event.target.files?.[0] || null)} className="mt-1.5 block w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/60 file:mr-3 file:rounded-lg file:border-0 file:bg-neon-purple/15 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-neon-purple" />
                  </label>
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      <aside className="space-y-6" aria-label="Play extras">
        <DailyChallengeCard songs={communitySongs} onPlay={handleLoadCommunitySong} />
        <ControlsCard keybindings={localSettings.keybindings} movingSliders={movingSlidersEnabled} onRebind={() => handleMainTabChange('SETTINGS')} />
        <RecentRunsCard runs={progress.recentRuns} />
      </aside>
    </div>
  );

  return (
    <>
    <AppShell
      activeTab={activeTab}
      onNavigate={handleShellNavigate}
      player={{ username, level: progress.level, xp: progress.xp, tier: getSeasonTier(progress) }}
      theme={localSettings.menuTheme}
    >
      <PageHeader title={pageCopy[activeTab].title} subtitle={pageCopy[activeTab].subtitle} />

      {error && (
        <div role="alert" className="mb-6 flex items-start justify-between gap-3 rounded-2xl border border-neon-pink/30 bg-neon-pink/10 px-4 py-3 text-sm text-neon-pink">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss message" className="shrink-0 rounded-lg p-0.5 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
      )}

      <Suspense fallback={<PanelFallback />}>
        {activeTab === 'LOCAL' ? playPage : (
          <div className={activeTab === 'GLOBAL' || activeTab === 'REPLAYS' ? 'rounded-3xl border border-white/[0.08] bg-white/[0.03] p-4 sm:p-6' : ''}>
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
                  className="space-y-2 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar touch-pan-y"
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
                  {hasMoreScores && !isLoadingMoreScores && (
                    <button type="button" onClick={() => void fetchMoreGlobalScores()} className="w-full rounded-2xl border border-white/10 py-3 text-sm font-semibold text-white/60 transition hover:border-white/20 hover:text-white">
                      Load more scores
                    </button>
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
                <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar touch-pan-y">
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
            ) : null}
          </div>
        )}
      </Suspense>
    </AppShell>

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

    </>
  );
};
