import React, { useMemo, useState } from 'react';
import { Award, Check, Gift, Gem, Lock, Palette, ShoppingBag, Sparkles, Star, Target, Trophy } from 'lucide-react';
import { Settings } from '../types';
import {
  claimMissionReward,
  claimSeasonReward,
  getSeasonRank,
  MissionProgress,
  PlayerProgress,
  purchaseCosmetic,
  SHOP_COSMETICS,
  ShopCosmetic,
} from '../utils/progression';

type ProgressTab = 'missions' | 'shop' | 'ranked' | 'achievements';

interface ProgressionHubProps {
  progress: PlayerProgress;
  settings: Settings;
  onSaveSettings: (settings: Settings) => void;
  onProgressUpdate: (progress: PlayerProgress) => void;
}

const ACHIEVEMENTS = [
  { id: 'first-run', label: 'First Pulse', description: 'Finish your first song.' },
  { id: 'combo-50', label: 'Flow State', description: 'Reach a 50-note combo.' },
  { id: 'accuracy-95', label: 'Laser Focus', description: 'Finish with 95% accuracy.' },
  { id: 'full-combo', label: 'Perfect Circuit', description: 'Full Combo any map.' },
  { id: 'ten-runs', label: 'Regular Player', description: 'Finish 10 songs.' },
];

const rankThresholds = [
  { rank: 'Bronze', points: 0, color: 'text-neon-orange' },
  { rank: 'Silver', points: 360, color: 'text-white' },
  { rank: 'Gold', points: 900, color: 'text-neon-orange' },
  { rank: 'Diamond', points: 1800, color: 'text-neon-blue' },
  { rank: 'Pulse Master', points: 3600, color: 'text-neon-purple' },
] as const;

const cosmeticKindStyles: Record<ShopCosmetic['kind'], string> = {
  avatar: 'border-neon-pink/30 bg-neon-pink/10 text-neon-pink',
  frame: 'border-neon-purple/30 bg-neon-purple/10 text-neon-purple',
  'lane-theme': 'border-neon-blue/30 bg-neon-blue/10 text-neon-blue',
  'hit-sound': 'border-neon-green/30 bg-neon-green/10 text-neon-green',
  'menu-theme': 'border-neon-orange/30 bg-neon-orange/10 text-neon-orange',
  'title-color': 'border-white/20 bg-white/10 text-white',
};

const MissionCard = ({ mission, onClaim }: { mission: MissionProgress; onClaim: (id: string) => void }) => {
  const percent = Math.min(100, (mission.progress / Math.max(1, mission.target)) * 100);
  return <article className={`rounded-2xl border p-4 ${mission.claimed ? 'border-white/8 bg-black/20 opacity-65' : mission.completed ? 'border-neon-green/30 bg-neon-green/[0.08]' : 'border-white/10 bg-black/20'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">{mission.cadence}</p><h4 className="mt-1 font-display text-base font-black text-white">{mission.label}</h4><p className="mt-1 text-xs text-white/40">{mission.type === 'accuracy' ? 'Finish a run with 92% accuracy.' : mission.type === 'combo' ? 'Reach a 75-note combo.' : mission.type === 'full-combo' ? 'Full Combo a map.' : mission.type === 'multiplayer' ? 'Finish multiplayer matches.' : `Play ${mission.songName || 'your selected spotlight map'} again.`}</p></div><span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 font-mono text-[9px] text-neon-blue">{mission.progress}/{mission.target}</span></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-neon-blue to-neon-purple" style={{ width: `${percent}%` }} /></div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-[10px] font-bold uppercase tracking-wider text-white/45">+{mission.rewardXp} XP · +{mission.rewardShards} Shards</p>{mission.claimed ? <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-neon-green"><Check className="h-3.5 w-3.5" /> Claimed</span> : mission.completed ? <button type="button" onClick={() => onClaim(mission.id)} className="rounded-lg bg-neon-green px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-black hover:bg-white">Claim</button> : <span className="text-[10px] font-black uppercase tracking-wider text-white/25">In progress</span>}</div></article>;
};

export const ProgressionHub: React.FC<ProgressionHubProps> = ({ progress, settings, onSaveSettings, onProgressUpdate }) => {
  const [tab, setTab] = useState<ProgressTab>('missions');
  const [notice, setNotice] = useState<string | null>(null);
  const rank = getSeasonRank(progress.seasonPoints);
  const nextRank = rankThresholds.find((entry) => entry.points > progress.seasonPoints);
  const missionGroups = useMemo(() => ({
    daily: progress.missions.missions.filter((mission) => mission.cadence === 'daily'),
    weekly: progress.missions.missions.filter((mission) => mission.cadence === 'weekly'),
  }), [progress.missions.missions]);

  const claimMission = (missionId: string) => {
    const result = claimMissionReward(missionId);
    if (!result) return;
    onProgressUpdate(result.progress);
    setNotice(`Claimed ${result.mission.rewardShards} Pulse Shards and ${result.mission.rewardXp} XP.`);
  };

  const buyCosmetic = (id: string) => {
    const result = purchaseCosmetic(id);
    if ('error' in result) {
      setNotice(result.error);
      return;
    }
    onProgressUpdate(result.progress);
    const nextSettings = { ...settings };
    if (result.cosmetic.kind === 'lane-theme') nextSettings.laneTheme = result.cosmetic.unlock as Settings['laneTheme'];
    if (result.cosmetic.kind === 'hit-sound') nextSettings.hitSound = result.cosmetic.unlock as Settings['hitSound'];
    if (result.cosmetic.kind === 'menu-theme') nextSettings.menuTheme = result.cosmetic.unlock as Settings['menuTheme'];
    onSaveSettings(nextSettings);
    setNotice(`${result.cosmetic.name} unlocked and equipped where applicable.`);
  };

  const claimSeason = () => {
    const result = claimSeasonReward();
    if (!result) {
      setNotice(rank === 'Bronze' ? 'Reach Silver to unlock the first seasonal reward.' : 'This seasonal reward has already been claimed.');
      return;
    }
    onProgressUpdate(result.progress);
    setNotice(`${result.rank} reward claimed: +${result.reward.shards} Shards and +${result.reward.xp} XP.`);
  };

  return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex max-w-full overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.04] p-1"><>{([['missions', 'Missions', Target], ['shop', 'Shop', ShoppingBag], ['ranked', 'Ranked', Trophy], ['achievements', 'Achievements', Award]] as const).map(([id, label, Icon]) => <button key={id} type="button" onClick={() => setTab(id)} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-wider transition ${tab === id ? 'bg-white text-black' : 'text-white/45 hover:text-white'}`}><Icon className="h-4 w-4" />{label}</button>)}</></div><div className="flex items-center gap-2 rounded-xl border border-neon-blue/20 bg-neon-blue/[0.07] px-3 py-2"><Gem className="h-4 w-4 text-neon-blue" /><span className="font-mono text-sm font-black text-neon-blue">{progress.pulseShards.toLocaleString()}</span><span className="text-[9px] font-black uppercase tracking-wider text-white/40">Shards</span></div></div>
    {notice && <div className="flex items-center justify-between gap-3 rounded-2xl border border-neon-green/25 bg-neon-green/[0.08] px-4 py-3 text-sm text-neon-green"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} className="text-xs font-black uppercase tracking-wider">Dismiss</button></div>}
    {tab === 'missions' ? <div className="space-y-6"><section><div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-neon-blue">Daily circuit</p><h3 className="mt-1 font-display text-xl font-black text-white">Today’s missions</h3></div><span className="text-xs text-white/35">Resets daily</span></div><div className="grid gap-3 lg:grid-cols-3">{missionGroups.daily.map((mission) => <div key={mission.id}><MissionCard mission={mission} onClaim={claimMission} /></div>)}</div></section><section><div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-neon-purple">Weekly run</p><h3 className="mt-1 font-display text-xl font-black text-white">Longer goals</h3></div><span className="text-xs text-white/35">Resets Monday</span></div><div className="grid gap-3 lg:grid-cols-2">{missionGroups.weekly.map((mission) => <div key={mission.id}><MissionCard mission={mission} onClaim={claimMission} /></div>)}</div></section></div> : tab === 'shop' ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{SHOP_COSMETICS.map((cosmetic) => { const owned = progress.ownedCosmeticIds.includes(cosmetic.id); const canBuy = progress.pulseShards >= cosmetic.cost; return <article key={cosmetic.id} className={`rounded-2xl border p-4 ${cosmeticKindStyles[cosmetic.kind]}`}><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-black uppercase tracking-[0.18em] opacity-70">{cosmetic.kind.replace('-', ' ')}</p><h3 className="mt-1 font-display text-lg font-black text-white">{cosmetic.name}</h3><p className="mt-1 text-xs leading-relaxed text-white/55">{cosmetic.description}</p></div><Palette className="h-5 w-5 shrink-0" /></div><div className="mt-4 flex items-center justify-between"><span className="font-mono text-sm font-black">{cosmetic.cost} ✦</span>{owned ? <span className="text-[10px] font-black uppercase tracking-wider text-neon-green">Owned</span> : <button type="button" disabled={!canBuy} onClick={() => buyCosmetic(cosmetic.id)} className="rounded-lg bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-black disabled:cursor-not-allowed disabled:opacity-30">Buy</button>}</div></article>; })}</div> : tab === 'ranked' ? <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]"><section className="rounded-3xl border border-neon-purple/25 bg-gradient-to-br from-neon-purple/[0.12] to-black/20 p-6"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-neon-purple">Season {progress.season}</p><h3 className="mt-2 font-display text-4xl font-black text-white">{rank}</h3><p className="mt-2 text-sm text-white/45">{progress.seasonPoints.toLocaleString()} ranked points · {progress.seasonRuns} ranked runs</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-gradient-to-r from-neon-purple to-neon-blue" style={{ width: `${nextRank ? Math.min(100, (progress.seasonPoints / nextRank.points) * 100) : 100}%` }} /></div><p className="mt-2 text-xs text-white/35">{nextRank ? `${Math.max(0, nextRank.points - progress.seasonPoints).toLocaleString()} points to ${nextRank.rank}` : 'Top seasonal tier reached.'}</p><button type="button" onClick={claimSeason} className="mt-6 w-full rounded-xl bg-neon-purple px-4 py-3 text-xs font-black uppercase tracking-wider text-white hover:bg-white hover:text-black">Claim seasonal reward</button>{progress.lastSeasonRecap && <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/45">Last season: <span className="font-bold text-white">{progress.lastSeasonRecap.rank}</span> · {progress.lastSeasonRecap.points.toLocaleString()} points across {progress.lastSeasonRecap.runs} runs.</div>}</section><section className="rounded-3xl border border-white/10 bg-white/[0.035] p-6"><div className="flex items-center gap-2"><Trophy className="h-5 w-5 text-neon-orange" /><h3 className="font-display text-xl font-black">Rank path</h3></div><div className="mt-5 space-y-3">{rankThresholds.map((entry) => <div key={entry.rank} className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/20 px-4 py-3"><div><p className={`font-display text-base font-black ${entry.color}`}>{entry.rank}</p><p className="mt-0.5 text-xs text-white/35">{entry.points.toLocaleString()} points</p></div><span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${progress.seasonPoints >= entry.points ? 'bg-neon-green/15 text-neon-green' : 'bg-white/5 text-white/30'}`}>{progress.seasonPoints >= entry.points ? 'Reached' : 'Locked'}</span></div>)}</div></section></div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{ACHIEVEMENTS.map((achievement) => { const unlocked = progress.achievements.includes(achievement.id); return <article key={achievement.id} className={`rounded-2xl border p-4 ${unlocked ? 'border-neon-orange/30 bg-neon-orange/[0.08]' : 'border-white/8 bg-black/20'}`}><div className="flex items-start gap-3">{unlocked ? <Star className="h-5 w-5 shrink-0 fill-neon-orange text-neon-orange" /> : <Lock className="h-5 w-5 shrink-0 text-white/20" />}<div><h3 className="font-display font-black text-white">{unlocked ? achievement.label : 'Hidden achievement'}</h3><p className="mt-1 text-xs leading-relaxed text-white/40">{unlocked ? achievement.description : 'Keep playing to reveal this reward.'}</p></div></div></article>; })}</div>}
  </div>;
};
