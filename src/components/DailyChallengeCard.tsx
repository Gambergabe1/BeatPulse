import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Play, Trophy } from 'lucide-react';
import { DIFFICULTY_VALUES } from '../../shared/chartFormat';
import { challengeDay, pickDailyChallenge, type DailyChallenge } from '../../shared/dailyChallenge';
import { CommunitySongRecord, getGlobalScores, GlobalScoreRecord } from '../services/pulseApi';
import { getDifficultyPreset } from '../utils/chartSettings';

const STORAGE_KEY = 'beatpulse_daily_challenge';

/** Today's challenge as last seen by the menu; App reads it to credit the daily mission. */
export const readStoredDailyChallenge = (): DailyChallenge | null => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as DailyChallenge | null;
    return stored && stored.day === challengeDay() ? stored : null;
  } catch {
    return null;
  }
};

const timeUntilReset = () => {
  const now = new Date();
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const minutes = Math.max(0, Math.floor((reset - now.getTime()) / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

interface DailyChallengeCardProps {
  songs: CommunitySongRecord[];
  onPlay: (song: CommunitySongRecord, difficulty: number) => Promise<void> | void;
}

export const DailyChallengeCard: React.FC<DailyChallengeCardProps> = ({ songs, onPlay }) => {
  const challenge = useMemo(() => pickDailyChallenge(songs), [songs]);
  const song = challenge ? songs.find((entry) => entry.id === challenge.songId) : undefined;
  const [board, setBoard] = useState<GlobalScoreRecord[] | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (!challenge) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(challenge));
    } catch {
      // The mission credit is a bonus; the card still works without storage.
    }
    let cancelled = false;
    // One request per menu visit: today's board does not need live polling.
    getGlobalScores({ songId: challenge.songId, difficulty: challenge.difficulty, since: `${challenge.day}T00:00:00.000Z`, limit: 5 })
      .then(({ scores }) => { if (!cancelled) setBoard(scores); })
      .catch(() => { if (!cancelled) setBoard([]); });
    return () => { cancelled = true; };
  }, [challenge?.day, challenge?.songId, challenge?.difficulty]);

  if (!challenge || !song) return null;
  const preset = getDifficultyPreset(DIFFICULTY_VALUES[challenge.difficulty]);

  return (
    <section className="rounded-3xl border border-neon-orange/30 bg-neon-orange/[0.07] p-5" aria-label="Daily challenge">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-neon-orange">
            <CalendarDays className="h-3.5 w-3.5" /> Daily challenge · resets in {timeUntilReset()}
          </p>
          <p className="mt-1 truncate font-display text-lg font-black text-white">{song.name}</p>
          <p className="truncate text-xs text-white/50">{song.artist} · {preset.label}</p>
        </div>
        <button
          type="button"
          disabled={isStarting}
          onClick={async () => {
            setIsStarting(true);
            try { await onPlay(song, DIFFICULTY_VALUES[challenge.difficulty]); } finally { setIsStarting(false); }
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-neon-orange px-3.5 py-2 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-white disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5 fill-current" /> {isStarting ? 'Loading…' : 'Play'}
        </button>
      </div>
      <ol className="mt-3 space-y-1">
        {board === null && <li className="text-[11px] text-white/35">Loading today's board…</li>}
        {board?.length === 0 && <li className="text-[11px] text-white/45">No scores yet today. Set the first one.</li>}
        {board?.map((entry, index) => (
          <li key={entry.id} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex min-w-0 items-center gap-1.5 text-white/70">
              {index === 0 ? <Trophy className="h-3 w-3 shrink-0 text-neon-orange" /> : <span className="w-3 shrink-0 text-center font-mono text-white/35">{index + 1}</span>}
              <span className="truncate">{entry.username}</span>
            </span>
            <span className="font-mono text-white/60">{entry.score.toLocaleString()} · {entry.accuracy.toFixed(1)}%</span>
          </li>
        ))}
      </ol>
    </section>
  );
};
