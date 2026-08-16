import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity, Ban, Bell, Check, Clipboard, Copy, Crown, Gamepad2, Heart, LogOut, Mail, MessageCircle,
  Plus, RefreshCw, Send, ShieldCheck, Star, UserMinus, UserPlus, Users, X,
} from 'lucide-react';
import {
  blockPlayer,
  changeMultiplayerRoomSong,
  CommunitySongRecord,
  createMultiplayerRoom,
  getDirectMessages,
  getRoomMessages,
  getSocialSnapshot,
  joinMultiplayerRoom,
  leaveMultiplayerRoom,
  MultiplayerRoom,
  PlayerIdentity,
  removeFriend,
  requestMultiplayerRematch,
  respondToFriendRequest,
  sendDirectMessage,
  sendFriendRequest,
  sendRoomMessage,
  setMultiplayerReady,
  SocialMessage,
  SocialPlayer,
  SocialSnapshot,
  startMultiplayerRoom,
  startSocialSession,
} from '../services/pulseApi';

type SocialView = 'profile' | 'friends' | 'messages' | 'multiplayer';

interface SocialHubProps {
  identity: PlayerIdentity;
  songs: CommunitySongRecord[];
  onLaunchMatch: (room: MultiplayerRoom) => Promise<void>;
}

const formatTime = (value: string) => new Intl.DateTimeFormat(undefined, {
  hour: 'numeric', minute: '2-digit',
}).format(new Date(value));

const presenceStyles = {
  online: 'bg-neon-green shadow-[0_0_8px_#39ff14]',
  'in-game': 'bg-neon-blue shadow-[0_0_8px_#00f3ff]',
  offline: 'bg-white/20',
};

const profileFrameStyles: Record<string, string> = {
  standard: 'border border-white/10',
  ripple: 'border border-neon-blue/55 shadow-[0_0_14px_rgba(0,243,255,0.28)]',
  crown: 'border border-neon-orange/60 shadow-[0_0_16px_rgba(255,176,0,0.3)]',
  prism: 'border border-neon-purple/60 shadow-[0_0_16px_rgba(168,85,247,0.32)]',
  orbit: 'border border-cyan-200/60 shadow-[0_0_18px_rgba(34,211,238,0.38)]',
};

export const SocialHub: React.FC<SocialHubProps> = ({ identity, songs, onLaunchMatch }) => {
  const [view, setView] = useState<SocialView>('profile');
  const [snapshot, setSnapshot] = useState<SocialSnapshot | null>(null);
  const [selectedFriend, setSelectedFriend] = useState<SocialPlayer | null>(null);
  const [messages, setMessages] = useState<SocialMessage[]>([]);
  const [roomMessages, setRoomMessages] = useState<SocialMessage[]>([]);
  const [friendCode, setFriendCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [selectedSongId, setSelectedSongId] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [roomDraft, setRoomDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const launchedRoomRef = useRef<string | null>(null);

  const room = snapshot?.activeRoom || null;
  const selectedSong = useMemo(
    () => songs.find((song) => song.id === room?.songId),
    [room?.songId, songs]
  );

  useEffect(() => {
    if (!selectedSongId && songs.length > 0) setSelectedSongId(songs[0].id);
  }, [selectedSongId, songs]);

  const showError = (caught: unknown) => {
    setError(caught instanceof Error ? caught.message : 'Something went wrong.');
  };

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const startedAt = performance.now();
      const next = await getSocialSnapshot(identity);
      setSnapshot(next);
      setLatencyMs(Math.round(performance.now() - startedAt));
      setError(null);
    } catch (caught) {
      showError(caught);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [identity.playerId, identity.username]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const startedAt = performance.now();
    startSocialSession(identity)
      .then((next) => { if (!cancelled) { setSnapshot(next); setLatencyMs(Math.round(performance.now() - startedAt)); setError(null); } })
      .catch((caught) => { if (!cancelled) showError(caught); })
      .finally(() => { if (!cancelled) setLoading(false); });
    const timer = window.setInterval(() => refresh(true), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [identity.playerId, identity.username, refresh]);

  useEffect(() => {
    if (!selectedFriend) return;
    const stillFriend = snapshot?.friends.find((friend) => friend.id === selectedFriend.id);
    if (!stillFriend) setSelectedFriend(null);
    else setSelectedFriend(stillFriend);
  }, [snapshot?.friends]);

  const loadDirectMessages = useCallback(async () => {
    if (!selectedFriend) return;
    try {
      setMessages(await getDirectMessages(identity, selectedFriend.id));
      await refresh(true);
    } catch (caught) { showError(caught); }
  }, [identity, selectedFriend?.id, refresh]);

  useEffect(() => {
    if (!selectedFriend || view !== 'messages') return;
    loadDirectMessages();
    const timer = window.setInterval(loadDirectMessages, 2500);
    return () => window.clearInterval(timer);
  }, [selectedFriend?.id, view, loadDirectMessages]);

  const loadLobbyMessages = useCallback(async () => {
    if (!room) return;
    try { setRoomMessages(await getRoomMessages(identity, room.id)); }
    catch (caught) { showError(caught); }
  }, [identity, room?.id]);

  useEffect(() => {
    if (!room || view !== 'multiplayer') return;
    loadLobbyMessages();
    const timer = window.setInterval(loadLobbyMessages, 2500);
    return () => window.clearInterval(timer);
  }, [room?.id, view, loadLobbyMessages]);

  useEffect(() => {
    if (!room?.startAt || room.status !== 'countdown') return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [room?.startAt, room?.status]);

  useEffect(() => {
    const isSpectator = Boolean(room?.spectators?.some((spectator) => spectator.playerId === identity.playerId));
    if (!room || room.status === 'lobby' || room.status === 'results' || isSpectator) {
      launchedRoomRef.current = null;
      return;
    }
    if (!room || !['countdown', 'playing'].includes(room.status)) return;
    if (launchedRoomRef.current === room.id) return;
    launchedRoomRef.current = room.id;
    setBusy(true);
    onLaunchMatch(room).catch((caught) => {
      launchedRoomRef.current = null;
      showError(caught);
    }).finally(() => setBusy(false));
  }, [room?.id, room?.status, room?.spectators, identity.playerId, onLaunchMatch]);

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await refresh(true); }
    catch (caught) { showError(caught); }
    finally { setBusy(false); }
  };

  const copyValue = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  };

  const openConversation = (friend: SocialPlayer) => {
    setSelectedFriend(friend);
    setView('messages');
  };

  const submitDirectMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedFriend || !messageDraft.trim()) return;
    const body = messageDraft.trim(); setMessageDraft('');
    await runAction(async () => {
      await sendDirectMessage(identity, selectedFriend.id, body);
      await loadDirectMessages();
    });
  };

  const submitRoomMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!room || !roomDraft.trim()) return;
    const body = roomDraft.trim(); setRoomDraft('');
    await runAction(async () => {
      await sendRoomMessage(identity, room.id, body);
      await loadLobbyMessages();
    });
  };

  const rankedParticipants = [...(room?.participants || [])].sort((a, b) => b.score - a.score);
  const selfParticipant = room?.participants.find((participant) => participant.playerId === identity.playerId);
  const isSpectator = Boolean(room?.spectators?.some((spectator) => spectator.playerId === identity.playerId));
  const isHost = room?.hostId === identity.playerId;
  const rematchVoteCount = room?.rematchVotes?.length || 0;
  const hasRematchVoted = Boolean(room?.rematchVotes?.includes(identity.playerId));
  const canStart = Boolean(room && room.participants.length >= 2 && room.participants.every((player) => player.ready));
  const countdownSeconds = room?.status === 'countdown' && room.startAt
    ? Math.max(0, Math.ceil((new Date(room.startAt).getTime() - clock) / 1000))
    : null;
  const notificationCount = (snapshot?.pendingIncoming.length || 0) + (snapshot?.unreadCount || 0) + (room ? 1 : 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex max-w-full overflow-x-auto no-scrollbar rounded-2xl border border-white/10 bg-white/5 p-1">
          {([
            ['profile', 'Profile', Activity, 0],
            ['friends', 'Friends', Users, snapshot?.pendingIncoming.length || 0],
            ['messages', 'Messages', MessageCircle, snapshot?.unreadCount || 0],
            ['multiplayer', 'Play', Gamepad2, room ? 1 : 0],
          ] as const).map(([id, label, Icon, count]) => (
            <button key={id} onClick={() => setView(id)} className={`relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider transition ${view === id ? 'bg-white text-black' : 'text-white/45 hover:text-white'}`}>
              <Icon className="h-4 w-4" /> {label}
              {count > 0 && <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-[9px] ${view === id ? 'bg-black text-white' : 'bg-neon-pink text-white'}`}>{count}</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2"><button onClick={() => setView(snapshot?.pendingIncoming.length ? 'friends' : snapshot?.unreadCount ? 'messages' : 'multiplayer')} className="relative rounded-xl border border-white/10 bg-white/5 p-2.5 text-white/40 transition hover:text-white" title="Open notifications"><Bell className="h-4 w-4" />{notificationCount > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-neon-pink px-1 py-0.5 text-[8px] font-black text-white">{notificationCount}</span>}</button><button onClick={() => refresh()} disabled={loading} className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-white/40 transition hover:text-white" title="Refresh social data"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
      </div>

      {error && <div className="flex items-center justify-between rounded-2xl border border-neon-pink/30 bg-neon-pink/10 px-4 py-3 text-sm text-neon-pink"><span>{error}</span><button onClick={() => setError(null)}><X className="h-4 w-4" /></button></div>}

      {loading && !snapshot ? (
        <div className="flex min-h-72 items-center justify-center"><RefreshCw className="h-7 w-7 animate-spin text-neon-blue" /></div>
      ) : view === 'profile' ? (
        <ProfileOverview profile={snapshot?.self} friends={snapshot?.friends || []} songs={songs} onMessage={openConversation} />
      ) : view === 'friends' ? (
        <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div><p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">Your friend code</p><p className="mt-1 font-mono text-lg font-bold text-neon-blue">{snapshot?.self.friendCode}</p></div>
              <button onClick={() => snapshot && copyValue(snapshot.self.friendCode, 'friend')} className="rounded-xl bg-neon-blue/10 p-3 text-neon-blue hover:bg-neon-blue hover:text-black">{copied === 'friend' ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}</button>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); if (friendCode.trim()) runAction(async () => { setSnapshot(await sendFriendRequest(identity, friendCode)); setFriendCode(''); }); }} className="flex gap-2">
              <input value={friendCode} onChange={(event) => setFriendCode(event.target.value.toUpperCase())} placeholder="PLAYER#1234" maxLength={20} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm uppercase outline-none focus:border-neon-blue/50" />
              <button disabled={busy || !friendCode.trim()} className="rounded-xl bg-neon-blue px-4 text-black disabled:opacity-30"><UserPlus className="h-5 w-5" /></button>
            </form>
            <p className="mt-3 text-xs leading-relaxed text-white/35">Share your code or enter a friend’s exact code. Friend requests keep your inbox private.</p>
          </section>

          <section className="space-y-4">
            {(snapshot?.pendingIncoming.length || 0) > 0 && <div className="rounded-3xl border border-neon-purple/25 bg-neon-purple/[0.07] p-5"><h4 className="mb-3 text-xs font-black uppercase tracking-widest text-neon-purple">Friend requests</h4><div className="space-y-2">{snapshot?.pendingIncoming.map((player) => <div key={player.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/25 p-3"><PlayerName player={player} /><div className="flex gap-2"><button onClick={() => runAction(async () => setSnapshot(await respondToFriendRequest(identity, player.friendshipId!, true)))} className="rounded-lg bg-neon-green/15 p-2 text-neon-green"><Check className="h-4 w-4" /></button><button onClick={() => runAction(async () => setSnapshot(await respondToFriendRequest(identity, player.friendshipId!, false)))} className="rounded-lg bg-white/5 p-2 text-white/40"><X className="h-4 w-4" /></button></div></div>)}</div></div>}
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-4 flex items-center justify-between"><h4 className="font-display font-bold">Your crew</h4><span className="text-xs text-white/35">{snapshot?.friends.length || 0} friends</span></div>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                {snapshot?.friends.length ? snapshot.friends.map((friend) => <motion.div layout key={friend.id} className="group flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-black/25 p-3 hover:border-white/15"><button onClick={() => openConversation(friend)} className="min-w-0 flex-1 text-left"><PlayerName player={friend} /></button><div className="flex items-center gap-1 opacity-60 transition group-hover:opacity-100"><button onClick={() => openConversation(friend)} title="Message" className="rounded-lg p-2 hover:bg-neon-blue/10 hover:text-neon-blue"><Mail className="h-4 w-4" /></button><button onClick={() => runAction(() => removeFriend(identity, friend.id))} title="Remove friend" className="rounded-lg p-2 hover:bg-white/10"><UserMinus className="h-4 w-4" /></button><button onClick={() => runAction(() => blockPlayer(identity, friend.id))} title="Block player" className="rounded-lg p-2 hover:bg-neon-pink/10 hover:text-neon-pink"><Ban className="h-4 w-4" /></button></div></motion.div>) : <EmptyState icon={Users} title="Your crew starts here" body="Add someone by friend code to see presence, message, and invite them to matches." />}
              </div>
              {(snapshot?.pendingOutgoing.length || 0) > 0 && <p className="mt-4 text-xs text-white/30">{snapshot?.pendingOutgoing.length} request{snapshot?.pendingOutgoing.length === 1 ? '' : 's'} waiting for a response.</p>}
            </div>
          </section>
        </div>
      ) : view === 'messages' ? (
        <div className="grid min-h-[440px] overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] md:grid-cols-[230px_1fr]">
          <aside className="border-b border-white/10 p-3 md:border-b-0 md:border-r">
            <p className="px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/30">Conversations</p>
            <div className="flex gap-2 overflow-x-auto md:block md:space-y-1">
              {snapshot?.friends.map((friend) => <button key={friend.id} onClick={() => setSelectedFriend(friend)} className={`flex min-w-48 items-center justify-between rounded-xl p-3 text-left transition md:w-full md:min-w-0 ${selectedFriend?.id === friend.id ? 'bg-neon-blue/15 text-white' : 'hover:bg-white/5'}`}><PlayerName player={friend} compact />{Boolean(friend.unread) && <span className="rounded-full bg-neon-pink px-2 py-0.5 text-[10px] font-bold">{friend.unread}</span>}</button>)}
            </div>
          </aside>
          <section className="flex min-h-[360px] flex-col">
            {selectedFriend ? <><header className="flex items-center justify-between border-b border-white/10 px-5 py-4"><PlayerName player={selectedFriend} /><div className="flex items-center gap-2">{room && <button onClick={() => runAction(() => sendDirectMessage(identity, selectedFriend.id, `Join my BeatPulse room: ${room.code}`, { roomCode: room.code }))} className="rounded-xl border border-neon-purple/30 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-neon-purple hover:bg-neon-purple/10">Invite</button>}<ShieldCheck className="h-4 w-4 text-white/25" /></div></header><div className="flex-1 space-y-3 overflow-y-auto p-5 custom-scrollbar">{messages.map((message) => <MessageBubble key={message.id} message={message} own={message.senderId === identity.playerId} />)}{messages.length === 0 && <EmptyState icon={MessageCircle} title="Start the conversation" body="Messages are private to accepted friends." />}</div><form onSubmit={submitDirectMessage} className="flex gap-2 border-t border-white/10 p-4"><input value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} maxLength={500} placeholder={`Message ${selectedFriend.username}`} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-neon-blue/50" /><button disabled={busy || !messageDraft.trim()} className="rounded-xl bg-neon-blue px-4 text-black disabled:opacity-30"><Send className="h-4 w-4" /></button></form></> : <EmptyState icon={Mail} title="Pick a friend" body="Choose a conversation to start messaging." />}
          </section>
        </div>
      ) : room ? (
        <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-3xl border border-neon-purple/25 bg-gradient-to-br from-neon-purple/10 to-transparent p-6">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><span className="rounded-full border border-neon-purple/30 bg-neon-purple/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-neon-purple">{room.status}</span><span className="text-xs text-white/35">{room.participants.length}/{room.maxPlayers} players</span>{countdownSeconds !== null && <span className="rounded-full border border-neon-green/25 bg-neon-green/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-neon-green">Starts in {countdownSeconds}s</span>}</div><h3 className="mt-3 text-2xl font-display font-black">{selectedSong?.name || 'Loading song...'}</h3><p className="text-sm text-white/40">{selectedSong?.artist || 'Community match'}</p></div><button onClick={() => copyValue(room.code, 'room')} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/30 px-4 py-3"><span><span className="block text-[9px] font-black uppercase tracking-widest text-white/30">Room code</span><span className="font-mono text-lg font-bold tracking-[0.2em] text-neon-blue">{room.code}</span></span>{copied === 'room' ? <Check className="h-4 w-4 text-neon-green" /> : <Clipboard className="h-4 w-4 text-white/40" />}</button></div>
            {room.status === 'lobby' && isHost && <div className="mb-5 rounded-2xl border border-neon-blue/20 bg-black/20 p-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-neon-blue">Match song</p><p className="mt-1 text-xs text-white/40">Changing it resets everyone elseâ€™s ready check.</p></div><select value={room.songId} disabled={busy} onChange={(event) => { const songId = event.target.value; if (songId !== room.songId) void runAction(() => changeMultiplayerRoomSong(identity, room.id, songId)); }} className="min-w-52 rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-neon-blue/50 disabled:opacity-50">{songs.map((song) => <option key={song.id} value={song.id}>{song.name} â€” {song.artist}</option>)}</select></div></div>}
            <div className="mb-5 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-wider"><span className={`rounded-full border px-2.5 py-1 ${latencyMs === null || latencyMs > 450 ? 'border-neon-orange/25 bg-neon-orange/10 text-neon-orange' : 'border-neon-green/25 bg-neon-green/10 text-neon-green'}`}>{latencyMs === null ? 'Checking connection' : `${latencyMs} ms ping`}</span>{isSpectator && <span className="rounded-full border border-neon-blue/25 bg-neon-blue/10 px-2.5 py-1 text-neon-blue">Spectating live</span>}{(room.spectators?.length || 0) > 0 && <span className="text-white/35">{room.spectators?.length} watching</span>}</div>
            {(room.spectators?.length || 0) > 0 && <div className="mb-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3"><p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/30">Spectators</p><p className="mt-1 text-sm text-white/60">{room.spectators?.map((spectator) => spectator.username).join(' · ')}</p></div>}
            <div className="space-y-2">{rankedParticipants.map((player, index) => <div key={player.playerId} className="rounded-2xl border border-white/8 bg-black/25 p-4"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="w-5 font-mono text-xs text-white/30">{room.status === 'results' ? `#${index + 1}` : ''}</span><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-neon-blue/30 to-neon-purple/20 p-2 text-center font-bold">{player.username.charAt(0).toUpperCase()}</div><div><p className="flex items-center gap-2 font-bold">{player.username}{room.hostId === player.playerId && <Crown className="h-3.5 w-3.5 text-neon-orange" />}{player.playerId === identity.playerId && <span className="text-[9px] uppercase text-white/30">You</span>}</p><p className="text-[10px] uppercase tracking-wider text-white/35">{room.status === 'lobby' ? (player.ready ? 'Ready' : 'Getting ready') : player.finished ? 'Finished' : `${Math.round(player.progress * 100)}% complete`}</p></div></div><div className="text-right">{room.status === 'lobby' ? <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${player.ready ? 'bg-neon-green/15 text-neon-green' : 'bg-white/5 text-white/30'}`}>{player.ready ? 'Ready' : 'Waiting'}</span> : <><p className="font-mono font-bold text-neon-blue">{player.score.toLocaleString()}</p><p className="text-[10px] text-neon-green">{player.accuracy.toFixed(1)}%</p></>}</div></div>{room.status !== 'lobby' && <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-neon-purple to-neon-blue transition-all" style={{ width: `${player.progress * 100}%` }} /></div>}</div>)}</div>
            <div className="mt-5 flex flex-wrap gap-3">{room.status === 'lobby' && !isHost && !isSpectator && <button onClick={() => runAction(() => setMultiplayerReady(identity, room.id, !selfParticipant?.ready))} className={`flex-1 rounded-2xl px-5 py-3 font-black uppercase tracking-wider ${selfParticipant?.ready ? 'border border-neon-green/30 bg-neon-green/10 text-neon-green' : 'bg-white text-black'}`}>{selfParticipant?.ready ? 'Ready!' : 'Ready up'}</button>}{room.status === 'lobby' && isHost && <button disabled={!canStart || busy} onClick={() => runAction(() => startMultiplayerRoom(identity, room.id))} className="flex-1 rounded-2xl bg-neon-green px-5 py-3 font-black uppercase tracking-wider text-black disabled:bg-white/10 disabled:text-white/25">{canStart ? 'Start match' : room.participants.length < 2 ? 'Waiting for players' : 'Waiting for ready checks'}</button>}{room.status === 'results' && !isSpectator && <button onClick={() => runAction(() => requestMultiplayerRematch(identity, room.id))} className={`flex-1 rounded-2xl px-5 py-3 font-black uppercase tracking-wider ${hasRematchVoted ? 'border border-neon-green/30 bg-neon-green/10 text-neon-green' : 'bg-neon-blue text-black'}`}>{hasRematchVoted ? `Rematch vote ${rematchVoteCount}/${room.participants.length}` : `Vote rematch ${rematchVoteCount}/${room.participants.length}`}</button>}<button onClick={() => runAction(() => leaveMultiplayerRoom(identity, room.id))} className="rounded-2xl border border-white/10 px-4 py-3 text-white/45 hover:bg-neon-pink/10 hover:text-neon-pink"><LogOut className="h-5 w-5" /></button></div>
          </section>
          <section className="flex min-h-[460px] flex-col rounded-3xl border border-white/10 bg-white/[0.035]"><header className="border-b border-white/10 px-5 py-4"><h4 className="font-display font-bold">Lobby chat</h4><p className="text-xs text-white/35">Coordinate before the beat drops.</p></header><div className="flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar">{roomMessages.map((message) => <MessageBubble key={message.id} message={message} own={message.senderId === identity.playerId} sender={room.participants.find((player) => player.playerId === message.senderId)?.username} />)}{roomMessages.length === 0 && <EmptyState icon={MessageCircle} title="Lobby is quiet" body="Say hello or call your difficulty." />}</div><form onSubmit={submitRoomMessage} className="flex gap-2 border-t border-white/10 p-4"><input value={roomDraft} onChange={(event) => setRoomDraft(event.target.value)} maxLength={500} placeholder="Message the lobby" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-neon-purple/50" /><button disabled={busy || !roomDraft.trim()} className="rounded-xl bg-neon-purple px-4 text-white disabled:opacity-30"><Send className="h-4 w-4" /></button></form></section>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <section className="rounded-3xl border border-neon-blue/20 bg-gradient-to-br from-neon-blue/10 to-transparent p-6"><div className="mb-5 inline-flex rounded-2xl bg-neon-blue/15 p-3 text-neon-blue"><Plus className="h-6 w-6" /></div><h3 className="text-xl font-display font-black">Host a live room</h3><p className="mt-2 text-sm leading-relaxed text-white/40">Pick any community chart. Up to eight players get the same countdown and live standings.</p><label className="mt-6 block text-[10px] font-black uppercase tracking-widest text-white/35">Match song</label><select value={selectedSongId} onChange={(event) => setSelectedSongId(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-neon-blue/50">{songs.map((song) => <option key={song.id} value={song.id}>{song.name} — {song.artist}</option>)}</select><button disabled={!selectedSongId || busy} onClick={() => runAction(() => createMultiplayerRoom(identity, selectedSongId))} className="mt-4 w-full rounded-2xl bg-neon-blue py-3.5 font-black uppercase tracking-wider text-black disabled:opacity-30">Create room</button>{songs.length === 0 && <p className="mt-3 text-xs text-neon-pink">The community library needs at least one song.</p>}</section>
          <section className="rounded-3xl border border-neon-purple/20 bg-gradient-to-br from-neon-purple/10 to-transparent p-6"><div className="mb-5 inline-flex rounded-2xl bg-neon-purple/15 p-3 text-neon-purple"><Gamepad2 className="h-6 w-6" /></div><h3 className="text-xl font-display font-black">Join with a code</h3><p className="mt-2 text-sm leading-relaxed text-white/40">Enter the six-character room code from a friend or invite message.</p><label className="mt-6 block text-[10px] font-black uppercase tracking-widest text-white/35">Room code</label><input value={joinCode} onChange={(event) => setJoinCode(event.target.value.replace(/[^a-f0-9]/gi, '').toUpperCase().slice(0, 6))} placeholder="A1B2C3" className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-lg font-bold uppercase tracking-[0.25em] outline-none focus:border-neon-purple/50" /><button disabled={joinCode.length !== 6 || busy} onClick={() => runAction(() => joinMultiplayerRoom(identity, joinCode))} className="mt-4 w-full rounded-2xl bg-neon-purple py-3.5 font-black uppercase tracking-wider text-white disabled:opacity-30">Join room</button></section>
        </div>
      )}
    </div>
  );
};

const PlayerName = ({ player, compact = false }: { player: SocialPlayer; compact?: boolean }) => (
  <div className="flex min-w-0 items-center gap-3"><div className={`${compact ? 'h-8 w-8' : 'h-10 w-10'} ${profileFrameStyles[player.selectedFrame] || profileFrameStyles.standard} relative flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-neon-blue/25 to-neon-purple/25 font-display font-black capitalize`}>{player.selectedAvatar === 'vinyl' ? '◉' : player.selectedAvatar === 'nova' ? '✦' : player.username.charAt(0).toUpperCase()}<span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-950 ${presenceStyles[player.status]}`} /></div><div className="min-w-0"><p className="truncate text-sm font-bold text-white">{player.username}{player.selectedBadge && <span className="ml-1 text-neon-orange">✦</span>}</p><p className="truncate text-[10px] uppercase tracking-wider text-white/30">Lvl {player.level} · {player.selectedTitle.replace(/-/g, ' ')} · {player.status === 'in-game' ? 'In a match' : player.status}</p></div></div>
);

const achievementLabel = (achievement: string) => achievement.replace(/-/g, ' ');

const ProfileOverview = ({ profile, friends, songs, onMessage }: { profile?: SocialPlayer; friends: SocialPlayer[]; songs: CommunitySongRecord[]; onMessage: (friend: SocialPlayer) => void }) => {
  if (!profile) return <EmptyState icon={Activity} title="Loading profile" body="Your profile will be ready in a moment." />;
  const favoriteSongs = profile.favoriteSongIds.map((id) => songs.find((song) => song.id === id)).filter((song): song is CommunitySongRecord => Boolean(song));
  const nextLevelXp = profile.level * profile.level * 90;
  const levelStartXp = Math.max(0, (profile.level - 1) * (profile.level - 1) * 90);
  const levelProgress = Math.min(100, Math.max(0, ((profile.xp - levelStartXp) / Math.max(1, nextLevelXp - levelStartXp)) * 100));
  return <div className="space-y-5"><section className="overflow-hidden rounded-3xl border border-neon-purple/25 bg-gradient-to-br from-neon-purple/15 via-neon-blue/[0.06] to-black/20 p-5 sm:p-7"><div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-4"><div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-white/10 font-display text-3xl font-black text-white ${profileFrameStyles[profile.selectedFrame] || profileFrameStyles.standard}`}>{profile.selectedAvatar === 'vinyl' ? '◉' : profile.selectedAvatar === 'nova' ? '✦' : profile.username.charAt(0).toUpperCase()}</div><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.22em] text-neon-purple">Public player profile</p><h3 className="mt-1 truncate font-display text-3xl font-black text-white">{profile.username}{profile.selectedBadge && <span className="ml-2 text-neon-orange">✦</span>}</h3><p className="mt-1 text-sm capitalize text-white/45">Level {profile.level} · {profile.selectedTitle.replace(/-/g, ' ')} · {profile.xp.toLocaleString()} total XP</p></div></div><div className="rounded-2xl border border-white/10 bg-black/25 px-5 py-3 text-right"><p className="font-display text-2xl font-black text-neon-blue">{profile.pulseShards.toLocaleString()}</p><p className="text-[9px] font-black uppercase tracking-wider text-white/35">Pulse shards</p></div></div><div className="mt-6 h-2 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-gradient-to-r from-neon-purple to-neon-blue" style={{ width: `${levelProgress}%` }} /></div><p className="mt-2 text-[10px] text-white/35">{Math.max(0, nextLevelXp - profile.xp).toLocaleString()} XP to level {profile.level + 1}</p></section>
    <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"><div className="flex items-center gap-2"><Star className="h-4 w-4 text-neon-orange" /><h4 className="font-display font-bold text-white">Achievements</h4></div><div className="mt-4 flex flex-wrap gap-2">{profile.achievements.length ? profile.achievements.map((achievement) => <span key={achievement} className="rounded-full border border-neon-orange/20 bg-neon-orange/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-neon-orange">{achievementLabel(achievement)}</span>) : <p className="text-xs text-white/35">Finish songs to start your collection.</p>}</div></section><section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"><div className="flex items-center gap-2"><Heart className="h-4 w-4 text-neon-pink" /><h4 className="font-display font-bold text-white">Favorite songs</h4></div><div className="mt-4 space-y-2">{favoriteSongs.length ? favoriteSongs.map((song) => <div key={song.id} className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2"><span className="min-w-0 truncate text-sm font-bold text-white">{song.name}</span><span className="ml-3 truncate text-xs text-white/35">{song.artist}</span></div>) : <p className="text-xs text-white/35">Heart a map in the Community library to feature it here.</p>}</div></section></div>
    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]"><section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-neon-green" /><h4 className="font-display font-bold text-white">Recent runs</h4></div><div className="mt-4 space-y-2">{profile.recentRuns.length ? profile.recentRuns.map((run) => <div key={run.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-black/20 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-white">{run.songName}</p><p className="mt-0.5 truncate text-[10px] uppercase tracking-wider text-white/35">{run.artist}{run.fullCombo ? ' · Full combo' : ''}</p></div><div className="text-right"><p className="font-mono text-sm font-bold text-neon-blue">{run.score.toLocaleString()}</p><p className="text-[10px] text-neon-green">{run.accuracy.toFixed(1)}%</p></div></div>) : <p className="py-5 text-center text-xs text-white/35">Your completed runs will appear here.</p>}</div></section><section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Users className="h-4 w-4 text-neon-blue" /><h4 className="font-display font-bold text-white">Friends</h4></div><span className="text-xs text-white/35">{friends.length}</span></div><div className="mt-4 space-y-2">{friends.length ? friends.slice(0, 6).map((friend) => <div key={friend.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/20 p-3"><PlayerName player={friend} compact /><button type="button" onClick={() => onMessage(friend)} className="rounded-lg border border-neon-blue/25 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-neon-blue hover:bg-neon-blue hover:text-black">Message</button></div>) : <p className="py-5 text-center text-xs text-white/35">Add friends by code to build your crew.</p>}</div></section></div>
  </div>;
};

const MessageBubble = ({ message, own, sender }: { key?: React.Key; message: SocialMessage; own: boolean; sender?: string }) => message.kind === 'system' ? (
  <div className="py-1 text-center text-[10px] font-bold uppercase tracking-wider text-white/35">{message.body}</div>
) : (
  <div className={`flex ${own ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[82%] rounded-2xl px-4 py-3 ${own ? 'rounded-br-md bg-neon-blue text-black' : 'rounded-bl-md bg-white/8 text-white'}`}>{sender && !own && <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-neon-purple">{sender}</p>}<p className="whitespace-pre-wrap break-words text-sm">{message.body}</p><p className={`mt-1 text-right text-[9px] ${own ? 'text-black/45' : 'text-white/25'}`}>{formatTime(message.createdAt)}</p>{message.kind === 'invite' && message.roomCode && <p className="mt-2 font-mono text-xs font-bold">ROOM {message.roomCode}</p>}</div></div>
);

const EmptyState = ({ icon: Icon, title, body }: { icon: React.ElementType; title: string; body: string }) => (
  <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center"><div className="mb-3 rounded-2xl bg-white/5 p-3 text-white/20"><Icon className="h-6 w-6" /></div><p className="font-display font-bold text-white/60">{title}</p><p className="mt-1 max-w-xs text-xs leading-relaxed text-white/30">{body}</p></div>
);
