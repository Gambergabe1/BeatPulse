import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Disc,
  Gamepad2,
  History,
  Library,
  Lock,
  MoreHorizontal,
  Settings as SettingsIcon,
  Sparkles,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import type { MainTab } from '../menuShared';

export type ShellTab = MainTab | 'ADMIN';

export interface NavItem {
  id: MainTab;
  label: string;
  hint: string;
  icon: React.ElementType;
}

/** Order here is the order of the sidebar and the mobile "More" sheet. */
export const NAV_ITEMS: NavItem[] = [
  { id: 'LOCAL', label: 'Play', hint: 'Upload a song or pick one to play', icon: Gamepad2 },
  { id: 'COMMUNITY', label: 'Library', hint: 'Community songs and charts', icon: Library },
  { id: 'SOCIAL', label: 'Social', hint: 'Friends, messages and live matches', icon: Users },
  { id: 'PROGRESS', label: 'Progress', hint: 'Missions, shop and rewards', icon: Sparkles },
  { id: 'GLOBAL', label: 'Leaderboards', hint: 'Top runs across every chart', icon: Trophy },
  { id: 'REPLAYS', label: 'Replays', hint: 'Rewatch saved runs', icon: History },
  { id: 'SETTINGS', label: 'Settings', hint: 'Controls, charts, visuals and sound', icon: SettingsIcon },
];

/** The four destinations that get a permanent slot in the mobile tab bar. */
const MOBILE_PRIMARY: MainTab[] = ['LOCAL', 'COMMUNITY', 'SOCIAL', 'PROGRESS'];

export interface ShellPlayer {
  username: string;
  level: number;
  xp: number;
  tier: string;
}

/** XP needed to reach a level; mirrors levelForXp in utils/progression. */
const xpForLevel = (level: number) => 90 * Math.max(0, level - 1) ** 2;

const PlayerCard: React.FC<{ player: ShellPlayer; compact?: boolean; onOpen: () => void }> = ({ player, compact, onOpen }) => {
  const start = xpForLevel(player.level);
  const next = xpForLevel(player.level + 1);
  const percent = Math.min(100, Math.max(0, ((player.xp - start) / Math.max(1, next - start)) * 100));
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open progress for ${player.username}, level ${player.level}`}
      className={`group flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] text-left transition hover:border-white/20 hover:bg-white/[0.07] ${compact ? 'px-2.5 py-1.5' : 'p-3'}`}
    >
      <span className={`flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-neon-purple/40 to-neon-blue/30 font-display font-black text-white ${compact ? 'h-7 w-7 text-sm' : 'h-10 w-10 text-lg'}`}>
        {(player.username || 'A').charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={`truncate font-semibold text-white ${compact ? 'text-xs' : 'text-sm'}`}>{player.username || 'Anonymous'}</span>
          <span className="shrink-0 rounded-md bg-neon-blue/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-neon-blue">Lv {player.level}</span>
        </span>
        {!compact && (
          <>
            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full bg-gradient-to-r from-neon-purple to-neon-blue" style={{ width: `${percent}%` }} />
            </span>
            <span className="mt-1.5 flex justify-between text-[11px] text-white/40">
              <span>{player.tier}</span>
              <span>{Math.max(0, next - player.xp).toLocaleString()} XP to Lv {player.level + 1}</span>
            </span>
          </>
        )}
      </span>
    </button>
  );
};

const Brand: React.FC<{ size?: 'sm' | 'md' }> = ({ size = 'md' }) => (
  <span className="flex items-center gap-2.5">
    <Disc className={`${size === 'sm' ? 'h-6 w-6' : 'h-8 w-8'} text-neon-blue`} aria-hidden />
    <span className={`font-display font-black uppercase italic tracking-tight ${size === 'sm' ? 'text-lg' : 'text-2xl'}`}>
      Beat<span className="text-neon-pink">Pulse</span>
    </span>
  </span>
);

interface AppShellProps {
  activeTab: ShellTab;
  onNavigate: (tab: ShellTab) => void;
  player: ShellPlayer;
  theme?: 'pulse' | 'aurora';
  children: React.ReactNode;
}

/**
 * Persistent app frame: a sidebar on large screens, a top bar plus bottom tab bar on
 * phones and tablets. Every section is one tap away and the current one is always marked.
 */
export const AppShell: React.FC<AppShellProps> = ({ activeTab, onNavigate, player, theme = 'pulse', children }) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreItems = NAV_ITEMS.filter((item) => !MOBILE_PRIMARY.includes(item.id));
  const isMoreActive = activeTab === 'ADMIN' || moreItems.some((item) => item.id === activeTab);

  useEffect(() => {
    if (!isMoreOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsMoreOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMoreOpen]);

  const go = (tab: ShellTab) => {
    setIsMoreOpen(false);
    onNavigate(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className={`relative min-h-screen w-full text-white ${theme === 'aurora' ? 'bg-[#080512]' : 'bg-[#05060a]'}`}>
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-neon-blue/[0.07] blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-neon-purple/[0.08] blur-[120px]" />
      </div>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/[0.06] bg-black/40 px-4 py-6 backdrop-blur-xl lg:flex">
        <div className="px-2"><Brand /></div>
        <nav aria-label="Main" className="mt-8 flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                aria-current={active ? 'page' : undefined}
                title={item.hint}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? 'bg-white/[0.08] text-white' : 'text-white/55 hover:bg-white/[0.04] hover:text-white'}`}
              >
                {active && <motion.span layoutId="nav-active" className="absolute inset-y-2 left-0 w-1 rounded-full bg-neon-blue" />}
                <Icon className={`h-[18px] w-[18px] ${active ? 'text-neon-blue' : 'text-white/45 group-hover:text-white/75'}`} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="space-y-2">
          <PlayerCard player={player} onOpen={() => go('PROGRESS')} />
          <button
            type="button"
            onClick={() => go('ADMIN')}
            aria-current={activeTab === 'ADMIN' ? 'page' : undefined}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition ${activeTab === 'ADMIN' ? 'text-neon-pink' : 'text-white/35 hover:text-white/70'}`}
          >
            <Lock className="h-3.5 w-3.5" /> Admin
          </button>
        </div>
      </aside>

      {/* Mobile and tablet top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/[0.06] bg-black/70 px-4 py-3 backdrop-blur-xl lg:hidden">
        <Brand size="sm" />
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 max-w-[170px]"><PlayerCard player={player} compact onOpen={() => go('PROGRESS')} /></div>
          <button
            type="button"
            onClick={() => go('SETTINGS')}
            aria-label="Settings"
            aria-current={activeTab === 'SETTINGS' ? 'page' : undefined}
            className={`rounded-xl border p-2 transition ${activeTab === 'SETTINGS' ? 'border-neon-blue/50 bg-neon-blue/10 text-neon-blue' : 'border-white/10 text-white/60 hover:text-white'}`}
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="relative z-10 px-4 pb-28 pt-6 sm:px-6 lg:ml-64 lg:px-10 lg:pb-12 lg:pt-10">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-black/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {NAV_ITEMS.filter((item) => MOBILE_PRIMARY.includes(item.id)).map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition ${active ? 'text-neon-blue' : 'text-white/50'}`}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setIsMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isMoreOpen}
            className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition ${isMoreActive ? 'text-neon-blue' : 'text-white/50'}`}
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {isMoreOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="More sections">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsMoreOpen(false)} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
              className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-white/10 bg-[#0b0d14] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            >
              <div className="mb-3 flex items-center justify-between px-2">
                <p className="text-sm font-semibold text-white/70">More</p>
                <button type="button" onClick={() => setIsMoreOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-white/50 hover:text-white"><X className="h-5 w-5" /></button>
              </div>
              <div className="grid gap-1">
                {[...moreItems, { id: 'ADMIN' as const, label: 'Admin', hint: 'Restricted tools for site admins', icon: Lock }].map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => go(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}
                    >
                      <span className={`rounded-xl p-2 ${active ? 'bg-neon-blue/15 text-neon-blue' : 'bg-white/5 text-white/60'}`}><Icon className="h-5 w-5" /></span>
                      <span>
                        <span className="block text-sm font-semibold text-white">{item.label}</span>
                        <span className="block text-xs text-white/45">{item.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

/** One consistent title block at the top of every section. */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions }) => (
  <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between lg:mb-8">
    <div className="min-w-0">
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-white/50">{subtitle}</p>}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </div>
);
