import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useMemo } from 'react';
import { Music, Upload, Play, Trophy, Disc, Cloud, Save, User, Users, Lock, Trash2, Edit2, Check, X, Activity, Settings as SettingsIcon, Search, ArrowLeft, RefreshCw } from 'lucide-react';
import { loadAudioFile, generateNotesFromAudio } from '../utils/audio';
import { DEFAULT_DIFFICULTY, DIFFICULTY_PRESETS, getChartSettingsForDifficulty, getDifficultyPreset } from '../utils/chartSettings';
import { SongData, Settings } from '../types';
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
  MultiplayerRoom,
  PlayerIdentity
} from '../services/pulseApi';
import { SocialHub } from './SocialHub';
import { getPlayerId, getPlayerToken } from '../utils/playerIdentity';
import { prefersMovingSliders } from '../utils/device';

interface MenuProps {
  onStartGame: (songData: SongData, isReplay?: boolean, replayEvents?: any[], multiplayer?: MultiplayerRoom) => void;
  audioContext: AudioContext;
  settings: Settings;
  onSaveSettings: (settings: Settings) => void;
}

type MainTab = 'LOCAL' | 'COMMUNITY' | 'SOCIAL' | 'GLOBAL' | 'SETTINGS' | 'REPLAYS';

const LEADERBOARD_REMOVAL_REASONS = [
  'Inappropriate name',
  'Cheating or impossible score',
  'Spam or duplicate entries',
  'Offensive content',
  'Requested removal',
];

const DEFAULT_CHART_SETTINGS = getChartSettingsForDifficulty(DEFAULT_DIFFICULTY);

const formatPercentLabel = (value: number) => `${Math.round(value * 100)}%`;

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

type IntegrityResultRow = {
  name: string;
  status: 'OK' | 'WARN' | 'ERROR';
  details: string;
};

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

export const Menu: React.FC<MenuProps> = ({ onStartGame, audioContext, settings, onSaveSettings }) => {
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
  const [username, setUsername] = useState(localStorage.getItem('username') || 'Anonymous');
  const playerId = useMemo(() => getPlayerId(), []);
  const playerToken = useMemo(() => getPlayerToken(), []);
  const movingSlidersEnabled = useMemo(prefersMovingSliders, []);
  const playerIdentity = useMemo<PlayerIdentity>(() => ({
    playerId,
    playerToken,
    username: username.trim() || 'Anonymous',
  }), [playerId, playerToken, username]);
  
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
  const [leaderboardRemovalTarget, setLeaderboardRemovalTarget] = useState<GlobalScoreRecord | null>(null);
  const [leaderboardRemovalReason, setLeaderboardRemovalReason] = useState(LEADERBOARD_REMOVAL_REASONS[0]);
  
  // Settings states
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [activeKeybindIndex, setActiveKeybindIndex] = useState<number | null>(null);
  const [savedReplays, setSavedReplays] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimeoutRef = useRef<any>(null);
  const isAdminPage = activeTab === 'ADMIN';
  const sectionMeta = ({
    LOCAL: { lead: 'Play', accent: 'Studio', subtitle: 'Load a track and shape your chart', icon: Activity, color: 'text-neon-blue' },
    COMMUNITY: { lead: 'Community', accent: 'Library', subtitle: 'Discover player-made rhythm charts', icon: Cloud, color: 'text-neon-blue' },
    SOCIAL: { lead: 'Pulse', accent: 'Network', subtitle: 'Friends · Messages · Live Matches', icon: Users, color: 'text-neon-purple' },
    GLOBAL: { lead: 'Global', accent: 'Rankings', subtitle: 'The best runs across every chart', icon: Trophy, color: 'text-neon-green' },
    REPLAYS: { lead: 'Replay', accent: 'Vault', subtitle: 'Rewatch and study your saved performances', icon: Play, color: 'text-neon-blue' },
    SETTINGS: { lead: 'Player', accent: 'Setup', subtitle: 'Tune controls, charts, visuals, and sound', icon: SettingsIcon, color: 'text-neon-purple' },
  } satisfies Record<MainTab, { lead: string; accent: string; subtitle: string; icon: React.ElementType; color: string }>)[activeTab === 'ADMIN' ? 'LOCAL' : activeTab];
  const SectionIcon = sectionMeta.icon;
  const chartSettings = getChartSettingsForDifficulty(complexity);
  const difficultyPreset = getDifficultyPreset(complexity);
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

    const timer = setTimeout(async () => {
      setIsRegenerating(true);
      try {
        const newNotes = await generateNotesFromAudio(readySong.audioBuffer, {
          complexity,
          density: effectiveDensity,
          laneVariety: effectiveLaneVariety,
          sliderProbability: effectiveSliderProbability,
          stamina: effectiveStamina,
          allowMovingSliders: movingSlidersEnabled
        });
        setReadySong(prev => prev ? {
          ...prev,
          notes: newNotes,
          difficulty: complexity,
          density: effectiveDensity,
          laneVariety: effectiveLaneVariety,
          sliderProbability: effectiveSliderProbability,
          stamina: effectiveStamina
        } : null);
      } catch (err) {
        console.error("Failed to regenerate notes:", err);
      } finally {
        setIsRegenerating(false);
      }
    }, 400); // 400ms debounce

    return () => clearTimeout(timer);
  }, [complexity, effectiveDensity, effectiveLaneVariety, effectiveSliderProbability, effectiveStamina, movingSlidersEnabled, readySong?.audioBuffer]);

  const loadStoredSongData = useCallback(async (
    song: any,
    chartOverrides?: Partial<Pick<SongData, 'difficulty' | 'density' | 'laneVariety' | 'sliderProbability' | 'stamina'>>
  ): Promise<SongData> => {
    if (!song.audioUrl) {
      throw new Error('Audio URL is missing');
    }

    const proxyAssetUrl = (assetUrl: string) => `/api/audio-proxy?url=${encodeURIComponent(assetUrl)}`;
    const response = await fetch(proxyAssetUrl(song.audioUrl));
    if (!response.ok) {
      throw new Error(`Failed to load audio: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const difficulty = chartOverrides?.difficulty ?? song.difficulty;
    const fallbackProfile = getChartSettingsForDifficulty(difficulty);
    const densityValue = chartOverrides?.density ?? song.density ?? fallbackProfile.density;
    const laneVarietyValue = chartOverrides?.laneVariety ?? song.laneVariety ?? fallbackProfile.laneVariety;
    const sliderProbabilityValue = chartOverrides?.sliderProbability ?? song.sliderProbability ?? fallbackProfile.sliderProbability;
    const staminaValue = chartOverrides?.stamina ?? song.stamina ?? fallbackProfile.stamina;

    let notes = [];
    if (Array.isArray(song.notes)) {
      notes = song.notes;
    } else if (typeof song.notes === 'string') {
      try {
        const parsedNotes = JSON.parse(song.notes);
        notes = Array.isArray(parsedNotes) ? parsedNotes : [];
      } catch (error) {
        console.warn('Failed to parse embedded notes, retrying with stored chart.', error);
      }
    }

    if (notes.length === 0 && song.notesUrl) {
      try {
        const notesResponse = await fetch(proxyAssetUrl(song.notesUrl));
        if (!notesResponse.ok) {
          throw new Error('Failed to fetch notes');
        }
        const parsedNotes = await notesResponse.json();
        notes = Array.isArray(parsedNotes) ? parsedNotes : [];
      } catch (error) {
        console.warn('Failed to fetch stored notes, regenerating chart.', error);
      }
    }

    if (notes.length === 0) {
      notes = await generateNotesFromAudio(audioBuffer, {
        complexity: difficulty,
        density: densityValue,
        laneVariety: laneVarietyValue,
        sliderProbability: sliderProbabilityValue,
        stamina: staminaValue,
        allowMovingSliders: movingSlidersEnabled
      });
    }

    return {
      id: song.id,
      name: song.name,
      artist: song.artist,
      audioBuffer,
      notes,
      difficulty,
      density: densityValue,
      laneVariety: laneVarietyValue,
      sliderProbability: sliderProbabilityValue,
      stamina: staminaValue
    };
  }, [audioContext, movingSlidersEnabled]);

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

    try {
      const audioBuffer = await loadAudioFile(file, audioContext);
      const notes = await generateNotesFromAudio(audioBuffer, {
        complexity,
        density: effectiveDensity,
        laneVariety: effectiveLaneVariety,
        sliderProbability: effectiveSliderProbability,
        stamina: effectiveStamina,
        allowMovingSliders: movingSlidersEnabled
      });

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
        stamina: effectiveStamina
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
      const newSong = await saveCommunitySong({
        audioFile: lastUploadedFile,
        name: metadata.name,
        artist: metadata.artist,
        difficulty: readySong.difficulty,
        density: readySong.density ?? 0.5,
        laneVariety: readySong.laneVariety ?? 0.5,
        sliderProbability: readySong.sliderProbability ?? 0.3,
        stamina: readySong.stamina ?? 0.5,
        authorName: username || 'Anonymous',
        notes: readySong.notes
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

  const handleLoadCommunitySong = useCallback(async (song: any) => {
    try {
      const songData = await loadStoredSongData(song);
      setMetadata({ name: song.name, artist: song.artist });
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
    const songData = await loadStoredSongData(song);
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
    if (newAdminPassword.length < 4) {
      setError('Password must be at least 4 characters');
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
      
      const proxyUrl = `/api/audio-proxy?url=${encodeURIComponent(audioUrl)}`;
      const audio = new Audio(proxyUrl);
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

  const filteredCommunitySongs = communitySongs.filter(song => 
    song.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    song.artist.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen w-full bg-black flex flex-col items-center justify-start md:justify-center p-6 md:p-12 relative overflow-x-hidden">
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
            <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest truncate max-w-[120px]">
              {username || 'Anonymous'}
            </span>
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
                </div>
                
                <p className="text-neon-blue/60 text-[10px] font-bold uppercase tracking-widest mb-6">
                  {isRegenerating ? '---' : `${readySong.notes.length} Notes Detected`}
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
            
            {activeTab === 'SOCIAL' ? (
              <SocialHub
                identity={playerIdentity}
                songs={communitySongs}
                onLaunchMatch={handleLaunchMultiplayer}
              />
            ) : activeTab === 'COMMUNITY' ? (
              <div className="flex flex-col gap-4">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input
                    type="text"
                    placeholder="Search by song name or artist..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-neon-blue/50 transition-all"
                  />
                </div>

                {filteredCommunitySongs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-white/20 border-2 border-dashed border-white/5 rounded-2xl">
                    <Music className="w-12 h-12 mb-4 opacity-10" />
                    <p className="text-sm font-bold uppercase tracking-widest">
                      {searchQuery ? 'No matches found' : 'No songs shared yet'}
                    </p>
                    <p className="text-xs mt-1">
                      {searchQuery ? 'Try a different search term' : 'Upload and save your own to start the collection!'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar touch-pan-y">
                    {filteredCommunitySongs.map((song) => (
                      <button
                        key={song.id}
                        onClick={() => {
                          handlePreviewStop();
                          handleLoadCommunitySong(song);
                        }}
                        onMouseEnter={() => handlePreviewStart(song.audioUrl)}
                        onMouseLeave={handlePreviewStop}
                        className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 transition-all text-left group w-full hover:bg-white/10 hover:border-neon-blue/30"
                      >
                        <div className="p-3 rounded-xl bg-neon-blue/10 text-neon-blue">
                          <Music className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-display font-bold text-white truncate">{song.name}</h4>
                          <p className="text-white/40 text-xs truncate">{song.artist}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-bold text-white/40 uppercase tracking-tighter">Top Score</p>
                          <p className="text-sm font-black text-neon-pink">{(song.topScore || 0).toLocaleString()}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
              !adminToken ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="p-4 rounded-full bg-neon-pink/10 text-neon-pink mb-6">
                    <Lock className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-display font-bold text-white mb-2">Admin Access</h3>
                  <p className="text-white/40 text-sm mb-6">Enter password to manage songs and leaderboard</p>
                  <form onSubmit={handleAdminLogin} className="w-full max-w-xs flex flex-col gap-4">
                    <input 
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="Password"
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-center focus:border-neon-pink outline-none"
                    />
                    <button 
                      type="submit"
                      disabled={isAdminLoading}
                      className={`w-full py-3 rounded-xl font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                        isAdminLoading 
                          ? 'bg-white/10 text-white/40 cursor-not-allowed' 
                          : 'bg-neon-pink text-white hover:bg-white hover:text-black'
                      }`}
                    >
                      {isAdminLoading ? (
                        <>
                          <Check className="w-4 h-4 animate-spin" />
                          Logging in...
                        </>
                      ) : 'Login'}
                    </button>
                  </form>
                </div>
              ) : (
                <div className="flex flex-col h-full">
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-sm font-bold text-neon-pink uppercase tracking-widest">Manage Songs + Leaderboard</p>
                    <div className="flex gap-4">
                      <button 
                        onClick={() => handleMainTabChange('LOCAL')}
                        className="text-xs text-neon-blue hover:text-white uppercase tracking-widest flex items-center gap-1"
                      >
                        <Upload className="w-3 h-3" />
                        Add New Song
                      </button>
                      <button 
                        onClick={() => setIsChangingPassword(!isChangingPassword)}
                        className="text-xs text-white/40 hover:text-white uppercase tracking-widest"
                      >
                        Change Password
                      </button>
                      <button 
                        onClick={runIntegrityCheck}
                        disabled={isCheckingIntegrity || isForcingStorageUpdate}
                        className={`text-xs uppercase tracking-widest flex items-center gap-1 ${
                          isCheckingIntegrity || isForcingStorageUpdate ? 'text-white/20' : 'text-neon-green hover:text-white'
                        }`}
                      >
                        <Check className={`w-3 h-3 ${isCheckingIntegrity ? 'animate-spin' : ''}`} />
                        Integrity Check
                      </button>
                      <button
                        onClick={handleForceStorageUpdate}
                        disabled={isForcingStorageUpdate || isCheckingIntegrity}
                        className={`text-xs uppercase tracking-widest flex items-center gap-1 ${
                          isForcingStorageUpdate || isCheckingIntegrity ? 'text-white/20' : 'text-neon-blue hover:text-white'
                        }`}
                      >
                        <RefreshCw className={`w-3 h-3 ${isForcingStorageUpdate ? 'animate-spin' : ''}`} />
                        Force Update
                      </button>
                      <button 
                        onClick={handleAdminLogout}
                        className="text-xs text-white/40 hover:text-white uppercase tracking-widest"
                      >
                        Logout
                      </button>
                    </div>
                  </div>
                  
                  {isChangingPassword && (
                    <form onSubmit={handleChangeAdminPassword} className="mb-6 p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-col gap-3">
                      <p className="text-xs font-bold text-white uppercase tracking-widest">New Admin Password</p>
                      <div className="flex gap-2">
                        <input 
                          type="password"
                          value={newAdminPassword}
                          onChange={(e) => setNewAdminPassword(e.target.value)}
                          placeholder="Enter new password"
                          className="flex-1 bg-black/50 border border-white/20 rounded-xl p-2 text-sm text-white focus:border-neon-pink outline-none"
                        />
                        <button 
                          type="submit"
                          disabled={isAdminLoading}
                          className={`px-4 py-2 rounded-xl font-bold uppercase tracking-widest transition-all text-xs flex items-center gap-2 ${
                            isAdminLoading 
                              ? 'bg-white/10 text-white/40 cursor-not-allowed' 
                              : 'bg-neon-pink text-white hover:bg-white hover:text-black'
                          }`}
                        >
                          {isAdminLoading ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </form>
                  )}

                  {integrityResults && (
                    <div className="mb-6 p-4 rounded-2xl bg-black/40 border border-white/10">
                      <div className="flex justify-between items-center mb-3">
                        <p className="text-xs font-bold text-white uppercase tracking-widest">Integrity Report</p>
                        <button onClick={() => setIntegrityResults(null)} className="text-white/40 hover:text-white">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="space-y-2 max-h-[150px] overflow-y-auto pr-2 custom-scrollbar">
                        {integrityResults.map((res) => (
                          <div key={`${res.name}-${res.status}`} className="rounded bg-white/5 p-2 space-y-1">
                            <div className="flex justify-between items-center text-[10px] font-mono">
                              <span className="text-white truncate max-w-[200px]">{res.name}</span>
                              <span className={
                                res.status === 'OK'
                                  ? 'text-neon-green'
                                  : res.status === 'WARN'
                                  ? 'text-yellow-400'
                                  : 'text-neon-pink'
                              }>
                                {res.status}
                              </span>
                            </div>
                            <p className="text-white/40 text-[10px]">{res.details}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mb-6 p-4 rounded-2xl bg-white/5 border border-white/10">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div>
                        <p className="text-xs font-bold text-white uppercase tracking-widest">Leaderboard Moderation</p>
                        <p className="text-white/40 text-xs mt-1">Remove a username from the global leaderboard and matching song leaderboards.</p>
                      </div>
                      <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                        {globalScores.length} loaded
                      </span>
                    </div>

                    {globalScores.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-white/30 text-xs uppercase tracking-widest">
                        No leaderboard entries loaded yet
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                        {globalScores.map((score) => (
                          <div key={score.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/30 border border-white/5 px-3 py-3">
                            <div className="min-w-0">
                              <p className="font-display font-bold text-white truncate">{score.username}</p>
                              <p className="text-[10px] text-white/40 uppercase tracking-wider truncate">
                                {score.songName} • {score.score.toLocaleString()} • {score.accuracy.toFixed(1)}%
                              </p>
                            </div>
                            <button
                              onClick={() => openLeaderboardRemoval(score)}
                              disabled={isModeratingLeaderboard}
                              className="shrink-0 px-3 py-2 rounded-xl bg-neon-pink/10 text-neon-pink hover:bg-neon-pink hover:text-white transition-all text-[10px] font-bold uppercase tracking-widest disabled:opacity-40"
                            >
                              Remove
                            </button>
                          </div>
                        ))}

                        {hasMoreScores && (
                          <button
                            onClick={fetchMoreGlobalScores}
                            disabled={isLoadingMoreScores}
                            className={`w-full mt-1 rounded-xl border border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${
                              isLoadingMoreScores
                                ? 'text-white/30 bg-white/5 cursor-not-allowed'
                                : 'text-neon-blue bg-neon-blue/10 hover:bg-neon-blue hover:text-black'
                            }`}
                          >
                            {isLoadingMoreScores ? 'Loading...' : 'Load More Scores'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar touch-pan-y">
                    {communitySongs.map((song) => (
                      <div key={song.id} className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col gap-3">
                        {editingSong === song.id ? (
                          <div className="flex flex-col gap-3">
                            <input 
                              type="text" 
                              value={editForm.name} 
                              onChange={e => setEditForm({...editForm, name: e.target.value})}
                              className="bg-black/50 border border-white/20 rounded-lg p-2 text-sm text-white"
                              placeholder="Song Name"
                            />
                            <input 
                              type="text" 
                              value={editForm.artist} 
                              onChange={e => setEditForm({...editForm, artist: e.target.value})}
                              className="bg-black/50 border border-white/20 rounded-lg p-2 text-sm text-white"
                              placeholder="Artist"
                            />
                            <div className="grid grid-cols-2 gap-3">
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] text-white/40 uppercase tracking-widest">Difficulty</span>
                                <input 
                                  type="number" 
                                  step="0.1" 
                                  min="0" 
                                  max="1"
                                  value={editForm.difficulty} 
                                  onChange={e => setEditForm({...editForm, difficulty: parseFloat(e.target.value)})}
                                  className="bg-black/50 border border-white/20 rounded-lg p-2 text-sm text-white"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] text-white/40 uppercase tracking-widest">Density</span>
                                <input 
                                  type="number" 
                                  step="0.1" 
                                  min="0" 
                                  max="1"
                                  value={(editForm as any).density} 
                                  onChange={e => setEditForm({...editForm, density: parseFloat(e.target.value)} as any)}
                                  className="bg-black/50 border border-white/20 rounded-lg p-2 text-sm text-white"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] text-white/40 uppercase tracking-widest">Lane Variety</span>
                                <input 
                                  type="number" 
                                  step="0.1" 
                                  min="0" 
                                  max="1"
                                  value={(editForm as any).laneVariety} 
                                  onChange={e => setEditForm({...editForm, laneVariety: parseFloat(e.target.value)} as any)}
                                  className="bg-black/50 border border-white/20 rounded-lg p-2 text-sm text-white"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] text-white/40 uppercase tracking-widest">Sliders</span>
                                <input 
                                  type="number" 
                                  step="0.1" 
                                  min="0" 
                                  max="1"
                                  value={(editForm as any).sliderProbability} 
                                  onChange={e => setEditForm({...editForm, sliderProbability: parseFloat(e.target.value)} as any)}
                                  className="bg-black/50 border border-white/20 rounded-lg p-2 text-sm text-white"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] text-white/40 uppercase tracking-widest">Stamina</span>
                                <input 
                                  type="number" 
                                  step="0.1" 
                                  min="0" 
                                  max="1"
                                  value={(editForm as any).stamina} 
                                  onChange={e => setEditForm({...editForm, stamina: parseFloat(e.target.value)} as any)}
                                  className="bg-black/50 border border-white/20 rounded-lg p-2 text-sm text-white"
                                />
                              </div>
                            </div>
                            <div className="flex gap-2 justify-end mt-2">
                              <button 
                                onClick={() => setEditingSong(null)} 
                                disabled={loadingSongId === song.id}
                                className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
                              >
                                <X className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => handleUpdateSong(song.id)} 
                                disabled={loadingSongId === song.id}
                                className={`p-2 rounded-lg transition-all flex items-center gap-2 ${
                                  loadingSongId === song.id 
                                    ? 'bg-white/10 text-white/40 cursor-not-allowed' 
                                    : 'bg-neon-green/20 text-neon-green hover:bg-neon-green/40'
                                }`}
                              >
                                {loadingSongId === song.id ? (
                                  <Check className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Check className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-display font-bold text-white truncate">{song.name}</h4>
                              <p className="text-white/40 text-xs truncate">{song.artist}</p>
                              <p className="text-neon-blue/60 text-[10px] mt-1">Diff: {song.difficulty}</p>
                            </div>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => startEditingSong(song)} 
                                disabled={loadingSongId !== null}
                                className="p-2 rounded-lg bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => handleDeleteSong(song.id)} 
                                disabled={loadingSongId !== null}
                                className={`p-2 rounded-lg transition-all flex items-center justify-center ${
                                  loadingSongId === song.id 
                                    ? 'bg-neon-pink text-white animate-pulse' 
                                    : 'bg-neon-pink/10 text-neon-pink hover:bg-neon-pink hover:text-white disabled:opacity-30'
                                }`}
                              >
                                {loadingSongId === song.id ? (
                                  <Trash2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            ) : activeTab === 'SETTINGS' ? (
              <div className="py-4">
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.9fr)]">
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-white/5 bg-white/5 p-5 sm:p-6">
                      <div className="mb-6">
                        <h4 className="flex items-center gap-2 font-display font-bold text-white">
                          <Activity className="h-5 w-5 text-neon-blue" />
                          Chart Difficulty
                        </h4>
                        <p className="mt-2 max-w-2xl text-sm text-white/50">
                          Pick a level and play. BeatPulse still adjusts the chart to each song's BPM and changing pace.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {DIFFICULTY_PRESETS.map((preset) => {
                          const isSelected = !advancedChartMode && difficultyPreset.id === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => selectDifficultyPreset(preset.value)}
                              className={`group rounded-2xl border p-4 text-left transition-all ${
                                isSelected
                                  ? 'border-neon-blue/60 bg-neon-blue/10 shadow-[0_0_28px_rgba(0,243,255,0.1)]'
                                  : 'border-white/10 bg-black/20 hover:border-white/25 hover:bg-white/[0.07]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className={`font-display text-lg font-black ${isSelected ? 'text-neon-blue' : 'text-white'}`}>
                                  {preset.label}
                                </span>
                                <span className={`h-2 w-2 rounded-full ${isSelected ? 'bg-neon-blue shadow-[0_0_10px_#00f3ff]' : 'bg-white/15'}`} />
                              </div>
                              <p className="mt-2 min-h-10 text-xs leading-relaxed text-white/45">{preset.description}</p>
                              <p className={`mt-3 text-[9px] font-black uppercase tracking-[0.18em] ${isSelected ? 'text-neon-blue/80' : 'text-white/25'}`}>
                                {preset.pace}
                              </p>
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-5 rounded-[24px] border border-white/8 bg-black/20 p-4 sm:p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold text-white">{advancedChartMode ? 'Custom profile' : `${difficultyPreset.label} profile`}</p>
                              <span className="rounded-full border border-neon-purple/20 bg-neon-purple/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-neon-purple">
                                BPM adaptive
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-white/40">
                              {advancedChartMode ? 'Manual values are active.' : difficultyPreset.description}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={toggleAdvancedChartMode}
                              className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-all ${
                                advancedChartMode
                                  ? 'border-neon-pink/35 bg-neon-pink/10 text-neon-pink hover:bg-neon-pink/20'
                                  : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                              }`}
                            >
                              {advancedChartMode ? 'Use preset' : 'Customize'}
                            </button>
                            <button
                              type="button"
                              onClick={resetChartSettings}
                              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/45 transition-all hover:bg-white/10 hover:text-white"
                            >
                              Reset
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {chartProfileRows.map((row) => (
                            <div key={row.label} className="rounded-xl border border-white/5 bg-white/[0.025] px-3 py-2.5">
                              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/30">{row.label}</p>
                              <p className={`mt-1 text-xs font-display font-bold ${row.accentClass}`}>{row.summary}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {advancedChartMode ? (
                        <div className="mt-5 rounded-[24px] border border-neon-pink/15 bg-neon-pink/[0.045] p-4 sm:p-5">
                          <div className="mb-5 flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-bold text-white">Customize chart</p>
                              <p className="mt-1 text-xs text-white/45">Fine tune only what matters to you.</p>
                            </div>
                            <span className="rounded-full border border-neon-pink/20 bg-neon-pink/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-neon-pink">
                              Custom
                            </span>
                          </div>

                          <div className="mb-4 rounded-2xl border border-white/8 bg-black/20 p-4">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold text-white">Base intensity</p>
                                <p className="mt-1 text-xs text-white/45">Overall pattern complexity.</p>
                              </div>
                              <span className="font-mono text-xs text-neon-purple">{formatPercentLabel(complexity)}</span>
                            </div>
                            <input
                              aria-label="Base chart intensity"
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={complexity}
                              onChange={(e) => setComplexity(parseFloat(e.target.value))}
                              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-neon-purple"
                            />
                            <div className="mt-3 flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-white/25">
                              <span>Simple</span><span>Complex</span>
                            </div>
                          </div>

                          <div className="grid gap-3 lg:grid-cols-2">
                            {advancedControls.map((control) => (
                              <div key={control.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                                <div className="mb-4 flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-bold text-white">{control.label}</p>
                                    <p className="mt-1 text-xs text-white/45">{control.hint}</p>
                                  </div>
                                  <span className={`font-mono text-xs ${control.valueClass}`}>{formatPercentLabel(control.value)}</span>
                                </div>
                                <input
                                  aria-label={control.label}
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.05"
                                  value={control.value}
                                  onChange={(e) => control.onChange(parseFloat(e.target.value))}
                                  className={`h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/10 ${control.accentClass}`}
                                />
                                <div className="mt-3 flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-white/25">
                                  <span>{control.minLabel}</span><span>{control.maxLabel}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="bg-white/5 border border-white/5 p-6 rounded-2xl">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-5">
                        <div>
                          <h4 className="font-display font-bold text-white">Keybindings</h4>
                          <p className={`text-xs mt-1 ${activeKeybindIndex !== null ? 'text-neon-pink' : 'text-white/40'}`}>
                            {keybindingPrompt}
                          </p>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
                          {activeKeybindIndex !== null ? 'Listening' : '4 Lanes'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {localSettings.keybindings.map((key, index) => (
                          <button
                            key={index}
                            onClick={() => setActiveKeybindIndex(index)}
                            className={`rounded-2xl border p-4 text-left transition-all ${
                              activeKeybindIndex === index
                                ? 'border-neon-pink bg-neon-pink/10 text-white shadow-[0_0_24px_rgba(255,0,153,0.15)]'
                                : 'border-white/10 bg-black/20 text-white hover:bg-white/10'
                            }`}
                          >
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Lane {index + 1}</p>
                            <p className="mt-3 font-display text-3xl font-black">
                              {activeKeybindIndex === index ? '?' : key.toUpperCase()}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="bg-white/5 border border-white/5 p-6 rounded-2xl">
                      <div className="mb-5">
                        <h4 className="font-display font-bold text-white flex items-center gap-2">
                          <SettingsIcon className="w-5 h-5 text-neon-purple" />
                          Quick Settings
                        </h4>
                        <p className="text-white/50 text-sm mt-2">
                          The everyday controls in one spot.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 mb-3">
                            Username
                          </label>
                          <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-neon-purple outline-none transition-all"
                            placeholder="Enter username"
                          />
                        </div>

                        <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                          <div className="flex items-center justify-between gap-3 mb-4">
                            <div>
                              <h5 className="text-sm font-bold text-white">Master Volume</h5>
                              <p className="text-xs text-white/40 mt-1">Adjust the overall game volume.</p>
                            </div>
                            <span className="text-neon-blue font-mono text-sm">{formatPercentLabel(localSettings.volume)}</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={localSettings.volume}
                            onChange={(e) => {
                              const newSettings = { ...localSettings, volume: parseFloat(e.target.value) };
                              setLocalSettings(newSettings);
                              onSaveSettings(newSettings);
                            }}
                            className="w-full accent-neon-blue h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>

                        <div className="rounded-2xl border border-white/8 bg-black/20 p-4 flex items-center justify-between gap-4">
                          <div>
                            <h5 className="text-sm font-bold text-white">Visual Effects</h5>
                            <p className="text-xs text-white/40 mt-1">Hit flashes and particles.</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${localSettings.visualEffects ? 'text-neon-green' : 'text-white/30'}`}>
                              {localSettings.visualEffects ? 'On' : 'Off'}
                            </span>
                            <button
                              onClick={() => {
                                const newSettings = { ...localSettings, visualEffects: !localSettings.visualEffects };
                                setLocalSettings(newSettings);
                                onSaveSettings(newSettings);
                              }}
                              className={`w-14 h-8 rounded-full transition-colors relative ${localSettings.visualEffects ? 'bg-neon-green' : 'bg-white/20'}`}
                            >
                              <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${localSettings.visualEffects ? 'left-7' : 'left-1'}`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
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
