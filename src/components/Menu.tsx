import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Music, Upload, Play, Trophy, Disc, Cloud, Save, User, Lock, Trash2, Edit2, Check, X, Activity, Settings as SettingsIcon, Search } from 'lucide-react';
import { loadAudioFile, generateNotesFromAudio } from '../utils/audio';
import { SongData, Settings } from '../types';
import {
  changeAdminPassword,
  deleteCommunitySong,
  getCommunitySongs,
  getGlobalScores,
  GlobalScoreRecord,
  getIntegrityReport,
  getReplays,
  loginAdmin,
  removeLeaderboardPlayer,
  saveCommunitySong,
  updateCommunitySong
} from '../services/pulseApi';

interface MenuProps {
  onStartGame: (songData: SongData, isReplay?: boolean, replayEvents?: any[]) => void;
  audioContext: AudioContext;
  settings: Settings;
  onSaveSettings: (settings: Settings) => void;
}

const LEADERBOARD_REMOVAL_REASONS = [
  'Inappropriate name',
  'Cheating or impossible score',
  'Spam or duplicate entries',
  'Offensive content',
  'Requested removal',
];

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const getTopScoreFromEntries = (entries: Array<{ score: number }>) =>
  entries.reduce((max, entry) => Math.max(max, Number(entry.score) || 0), 0);

export const Menu: React.FC<MenuProps> = ({ onStartGame, audioContext, settings, onSaveSettings }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [readySong, setReadySong] = useState<SongData | null>(null);
  const [metadata, setMetadata] = useState({ name: '', artist: '' });
  const [error, setError] = useState<string | null>(null);
  const [complexity, setComplexity] = useState(settings.complexity ?? 0.5);
  const [density, setDensity] = useState(settings.density ?? 0.5);
  const [laneVariety, setLaneVariety] = useState(settings.laneVariety ?? 0.5);
  const [sliderProbability, setSliderProbability] = useState(settings.sliderProbability ?? 0.3);
  const [stamina, setStamina] = useState(settings.stamina ?? 0.5);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [communitySongs, setCommunitySongs] = useState<any[]>([]);
  const [globalScores, setGlobalScores] = useState<GlobalScoreRecord[]>([]);
  const [globalScoresOffset, setGlobalScoresOffset] = useState<number>(0);
  const [isLoadingMoreScores, setIsLoadingMoreScores] = useState(false);
  const [hasMoreScores, setHasMoreScores] = useState(true);
  const [activeTab, setActiveTab] = useState<'LOCAL' | 'COMMUNITY' | 'GLOBAL' | 'ADMIN' | 'SETTINGS' | 'REPLAYS'>('LOCAL');
  const [isSaving, setIsSaving] = useState(false);
  const [lastUploadedFile, setLastUploadedFile] = useState<File | null>(null);
  const [username, setUsername] = useState(localStorage.getItem('username') || 'Anonymous');
  
  // Admin states
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(localStorage.getItem('adminToken'));
  const [adminPassword, setAdminPassword] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [editingSong, setEditingSong] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ name: '', artist: '', difficulty: 0.5, density: 0.5, laneVariety: 0.5, sliderProbability: 0.3, stamina: 0.5 });
  const [integrityResults, setIntegrityResults] = useState<any[] | null>(null);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [isAdminLoading, setIsAdminLoading] = useState(false);
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

  // Sync generation settings to parent settings
  useEffect(() => {
    const updatedSettings = {
      ...settings,
      complexity,
      density,
      laneVariety,
      sliderProbability,
      stamina
    };
    onSaveSettings(updatedSettings);
  }, [complexity, density, laneVariety, sliderProbability, stamina]);

  useEffect(() => {
    const fetchCommunitySongs = async () => {
      try {
        const songs = await getCommunitySongs();
        setCommunitySongs(songs);
      } catch (err) {
        console.error('Failed to fetch songs:', err);
      }
    };
      
    const fetchGlobalScores = async () => {
      try {
        const { scores, nextOffset } = await getGlobalScores({ limit: 100, offset: 0 });
        setGlobalScores(scores);
        setGlobalScoresOffset(nextOffset || 0);
        setHasMoreScores(nextOffset !== null);
      } catch (err) {
        console.error('Failed to fetch global scores:', err);
      }
    };
    fetchGlobalScores();
      
    const fetchReplays = async () => {
      try {
        const replays = await getReplays();
        setSavedReplays(replays);
      } catch (err) {
        console.error('Failed to fetch replays:', err);
      }
    };

    fetchCommunitySongs();
    fetchReplays();
  }, []);

  // Dynamic note scaling when complexity changes
  useEffect(() => {
    if (!readySong) return;

    const timer = setTimeout(async () => {
      setIsRegenerating(true);
      try {
        const newNotes = await generateNotesFromAudio(readySong.audioBuffer, {
          complexity,
          density,
          laneVariety,
          sliderProbability,
          stamina
        });
        setReadySong(prev => prev ? {
          ...prev,
          notes: newNotes,
          difficulty: complexity
        } : null);
      } catch (err) {
        console.error("Failed to regenerate notes:", err);
      } finally {
        setIsRegenerating(false);
      }
    }, 400); // 400ms debounce

    return () => clearTimeout(timer);
  }, [complexity, density, laneVariety, sliderProbability, stamina, readySong?.audioBuffer]);

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
    const densityValue = chartOverrides?.density ?? song.density ?? difficulty;
    const laneVarietyValue = chartOverrides?.laneVariety ?? song.laneVariety ?? difficulty;
    const sliderProbabilityValue = chartOverrides?.sliderProbability ?? song.sliderProbability ?? 0.3;
    const staminaValue = chartOverrides?.stamina ?? song.stamina ?? 0.5;

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
        stamina: staminaValue
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
  }, [audioContext]);

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
        density,
        laneVariety,
        sliderProbability,
        stamina
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
        difficulty: complexity
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
      setActiveTab('LOCAL');
    } catch (err) {
      console.error(err);
      setError('Failed to load song audio.');
    }
  }, [loadStoredSongData]);

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
    setActiveTab('LOCAL');
  };

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
      setCommunitySongs(prev => prev.filter(s => s.id !== id));
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
      await updateCommunitySong(id, editForm, adminToken);
      setCommunitySongs(prev => prev.map(s => s.id === id ? { ...s, ...editForm } : s));
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
      const report = await getIntegrityReport();
      const results = [
        { name: 'Songs Collection', status: 'OK', details: `${report.songsCount} songs found` },
        { name: 'Global Scores Collection', status: 'OK', details: `${report.scoresCount} scores found` },
        { name: 'Replays Collection', status: 'OK', details: `${report.replaysCount} replays found` },
        {
          name: 'Song Storage Files',
          status: report.missingAssetSongsCount > 0 ? 'WARN' : 'OK',
          details:
            report.missingAssetSongsCount > 0
              ? `${report.missingAssetSongsCount} songs have missing audio/notes files`
              : 'Song audio + notes files are present for all stored songs',
        },
      ];

      if (report.missingAssetSongsCount > 0) {
        report.missingAssetSongs.forEach((entry) => {
          const missing = [];
          if (entry.missingAudio) missing.push("audio");
          if (entry.missingNotes) missing.push("notes");
          results.push({
            name: `Missing Files: ${entry.name} (${entry.artist})`,
            status: 'ERROR',
            details: `Missing: ${missing.join(", ") || "unknown"}`,
          });
        });
      }

      setIntegrityResults(results);
    } catch (err: any) {
      console.error("Integrity check failed:", err);
      setError(`Integrity check failed: ${err.message || 'Unknown error'}`);
      setIntegrityResults([{ name: 'Integrity Check', status: 'ERROR', details: err.message || 'Unknown error' }]);
    } finally {
      setIsCheckingIntegrity(false);
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
        className="z-10 flex flex-col items-center max-w-2xl w-full"
      >
        <div className="mb-12 text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
            className="inline-block mb-4"
          >
            <Disc className="w-16 h-16 text-neon-blue" />
          </motion.div>
          <h1 className="text-7xl md:text-8xl font-display font-black tracking-tighter italic uppercase mb-2">
            Beat<span className="text-neon-pink">Pulse</span>
          </h1>
          <p className="text-white/40 font-display font-bold tracking-[0.3em] uppercase text-sm">
            Rhythm Evolution
          </p>
        </div>

        {/* Top Utility Buttons */}
        <div className="w-full flex justify-end gap-3 mb-6">
          <div className="flex items-center gap-3 px-4 py-2 rounded-xl border border-white/10 bg-white/5">
            <div className="w-5 h-5 rounded-full bg-neon-purple/20 flex items-center justify-center">
              <User className="w-3 h-3 text-neon-purple" />
            </div>
            <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest truncate max-w-[120px]">
              {username || 'Anonymous'}
            </span>
          </div>
          <button 
            onClick={() => setActiveTab('ADMIN')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all font-display font-bold text-xs uppercase tracking-widest ${
              activeTab === 'ADMIN' 
                ? 'bg-neon-pink text-white border-neon-pink shadow-[0_0_15px_rgba(255,0,111,0.3)]' 
                : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20'
            }`}
          >
            <Lock className="w-4 h-4" />
            Admin
          </button>
          <button 
            onClick={() => setActiveTab('SETTINGS')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all font-display font-bold text-xs uppercase tracking-widest ${
              activeTab === 'SETTINGS' 
                ? 'bg-neon-blue text-black border-neon-blue shadow-[0_0_15px_rgba(0,243,255,0.3)]' 
                : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20'
            }`}
          >
            <SettingsIcon className="w-4 h-4" />
            Settings
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
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
                Hit the keys when the notes cross the line.
              </p>
            </div>
          </div>

          {/* Community Library Card */}
          <div className="md:col-span-2 rounded-[2rem] bg-black/40 backdrop-blur-xl border border-white/10 p-8 flex flex-col shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-neon-blue/50 to-transparent" />
            
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-neon-blue blur-lg opacity-20 animate-pulse" />
                  <div className="relative p-3 rounded-2xl bg-neon-blue/10 border border-neon-blue/20 text-neon-blue">
                    <Cloud className="w-6 h-6" />
                  </div>
                </div>
                <div>
                  <h3 className="text-2xl font-display font-black uppercase tracking-tight italic">
                    Community <span className="text-neon-blue">Library</span>
                  </h3>
                  <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-bold">Global Rhythm Database</p>
                </div>
              </div>

              <div className="flex bg-white/5 backdrop-blur-md rounded-2xl p-1.5 border border-white/5 self-start lg:self-center">
                {[
                  { id: 'LOCAL', label: 'Local', icon: <Activity className="w-3.5 h-3.5" /> },
                  { id: 'COMMUNITY', label: 'Community', icon: <Cloud className="w-3.5 h-3.5" /> },
                  { id: 'GLOBAL', label: 'Global Scores', icon: <Trophy className="w-3.5 h-3.5" /> },
                  { id: 'REPLAYS', label: 'Replays', icon: <Play className="w-3.5 h-3.5" /> }
                ].map((tab) => (
                  <button 
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
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
            </div>
            
            {activeTab === 'COMMUNITY' ? (
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
                        onClick={() => setActiveTab('LOCAL')}
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
                        disabled={isCheckingIntegrity}
                        className={`text-xs uppercase tracking-widest flex items-center gap-1 ${isCheckingIntegrity ? 'text-white/20' : 'text-neon-green hover:text-white'}`}
                      >
                        <Check className={`w-3 h-3 ${isCheckingIntegrity ? 'animate-spin' : ''}`} />
                        Integrity Check
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
                              <span className={res.status === 'OK' ? 'text-neon-green' : 'text-neon-pink'}>
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
              <div className="flex flex-col gap-6 py-4">
                {/* Profile */}
                <div className="bg-white/5 border border-white/5 p-6 rounded-2xl flex items-center gap-6">
                  <div className="p-4 rounded-2xl bg-neon-purple/10 text-neon-purple">
                    <User className="w-8 h-8" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-display font-bold text-white mb-1">Username</h4>
                    <input 
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-neon-purple outline-none transition-all"
                      placeholder="Enter username"
                    />
                  </div>
                </div>

                {/* Generation Settings */}
                <div className="bg-white/5 border border-white/5 p-6 rounded-2xl">
                  <h4 className="font-display font-bold text-white mb-6 flex items-center gap-2">
                    <Disc className="w-5 h-5 text-neon-blue" />
                    Generation Settings
                  </h4>
                  
                  <div className="space-y-8">
                    {/* Difficulty */}
                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-white font-bold text-sm">Difficulty</p>
                          <p className="text-white/40 text-[10px] uppercase tracking-widest">Base complexity</p>
                        </div>
                        <span className="text-neon-purple font-mono text-xs">{Math.round(complexity * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest w-8 text-right">Easy</span>
                        <input 
                          type="range" 
                          min="0" 
                          max="1" 
                          step="0.1" 
                          value={complexity} 
                          onChange={(e) => setComplexity(parseFloat(e.target.value))}
                          className="flex-1 accent-neon-purple h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="text-[10px] font-black text-neon-purple uppercase tracking-widest w-16">Expert</span>
                      </div>
                    </div>

                    {/* Density */}
                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-white font-bold text-sm">Density</p>
                          <p className="text-white/40 text-[10px] uppercase tracking-widest">Note frequency</p>
                        </div>
                        <span className="text-neon-green font-mono text-xs">{Math.round(density * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest w-8 text-right">Low</span>
                        <input 
                          type="range" 
                          min="0" 
                          max="1" 
                          step="0.1" 
                          value={density} 
                          onChange={(e) => setDensity(parseFloat(e.target.value))}
                          className="flex-1 accent-neon-green h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="text-[10px] font-black text-neon-green uppercase tracking-widest w-16">High</span>
                      </div>
                    </div>

                    {/* Lane Variety */}
                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-white font-bold text-sm">Lane Variety</p>
                          <p className="text-white/40 text-[10px] uppercase tracking-widest">Lane changes</p>
                        </div>
                        <span className="text-neon-pink font-mono text-xs">{Math.round(laneVariety * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest w-8 text-right">Low</span>
                        <input 
                          type="range" 
                          min="0" 
                          max="1" 
                          step="0.1" 
                          value={laneVariety} 
                          onChange={(e) => setLaneVariety(parseFloat(e.target.value))}
                          className="flex-1 accent-neon-pink h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="text-[10px] font-black text-neon-pink uppercase tracking-widest w-16">High</span>
                      </div>
                    </div>

                    {/* Sliders */}
                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-white font-bold text-sm">Sliders</p>
                          <p className="text-white/40 text-[10px] uppercase tracking-widest">Slider probability</p>
                        </div>
                        <span className="text-neon-blue font-mono text-xs">{Math.round(sliderProbability * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest w-8 text-right">Low</span>
                        <input 
                          type="range" 
                          min="0" 
                          max="1" 
                          step="0.1" 
                          value={sliderProbability} 
                          onChange={(e) => setSliderProbability(parseFloat(e.target.value))}
                          className="flex-1 accent-neon-blue h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="text-[10px] font-black text-neon-blue uppercase tracking-widest w-16">High</span>
                      </div>
                    </div>

                    {/* Stamina */}
                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-white font-bold text-sm">Stamina</p>
                          <p className="text-white/40 text-[10px] uppercase tracking-widest">Burst capacity</p>
                        </div>
                        <span className="text-neon-orange font-mono text-xs">{Math.round(stamina * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest w-8 text-right">Low</span>
                        <input 
                          type="range" 
                          min="0" 
                          max="1" 
                          step="0.1" 
                          value={stamina} 
                          onChange={(e) => setStamina(parseFloat(e.target.value))}
                          className="flex-1 accent-neon-orange h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="text-[10px] font-black text-neon-orange uppercase tracking-widest w-16">High</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Volume */}
                <div className="bg-white/5 border border-white/5 p-6 rounded-2xl">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h4 className="font-display font-bold text-white">Master Volume</h4>
                      <p className="text-white/40 text-xs">Adjust the overall game volume</p>
                    </div>
                    <span className="text-neon-blue font-mono">{Math.round(localSettings.volume * 100)}%</span>
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

                {/* Visual Effects */}
                <div className="bg-white/5 border border-white/5 p-6 rounded-2xl flex justify-between items-center">
                  <div>
                    <h4 className="font-display font-bold text-white">Visual Effects</h4>
                    <p className="text-white/40 text-xs">Enable hit flashes and particles</p>
                  </div>
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

                {/* Keybindings */}
                <div className="bg-white/5 border border-white/5 p-6 rounded-2xl">
                  <div className="mb-4">
                    <h4 className="font-display font-bold text-white">Keybindings</h4>
                    <p className="text-white/40 text-xs">Click a key to rebind it</p>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    {localSettings.keybindings.map((key, index) => (
                      <div key={index} className="flex flex-col items-center gap-2">
                        <span className="text-xs text-white/40 uppercase tracking-widest">Lane {index + 1}</span>
                        <button
                          onClick={() => setActiveKeybindIndex(index)}
                          className={`w-full aspect-square rounded-xl font-display font-black text-2xl transition-all flex items-center justify-center ${
                            activeKeybindIndex === index 
                              ? 'bg-neon-pink text-white animate-pulse' 
                              : 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
                          }`}
                        >
                          {activeKeybindIndex === index ? '?' : key.toUpperCase()}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-white/20 border-2 border-dashed border-white/5 rounded-2xl">
                <p className="text-sm font-bold uppercase tracking-widest">Local songs list would go here</p>
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
              <p className="text-white/60 text-sm mb-8">This action cannot be undone. Are you sure you want to remove this song from the community library?</p>
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



