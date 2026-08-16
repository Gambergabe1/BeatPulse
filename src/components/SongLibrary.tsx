import React, { useEffect, useMemo, useState } from 'react';
import { Heart, Music, Play, Search, Sparkles, Star, Volume2, X } from 'lucide-react';
import { CommunitySongRecord, getMapReviews, MapReview, saveMapReview } from '../services/pulseApi';

interface PersonalBest {
  score: number;
  accuracy: number;
  maxCombo: number;
}

interface SongLibraryProps {
  songs: CommunitySongRecord[];
  favoriteSongIds: string[];
  onToggleFavorite: (songId: string) => void;
  onLoadSong: (song: CommunitySongRecord) => void;
  onPreviewStart: (audioUrl: string) => void;
  onPreviewStop: () => void;
}

type SortMode = 'featured' | 'top-score' | 'newest';

const readPersonalBest = (songId: string): PersonalBest | null => {
  try {
    const value = JSON.parse(localStorage.getItem(`beatpulse_personal_best:${songId}`) || 'null') as PersonalBest | null;
    return value && Number.isFinite(value.score) ? value : null;
  } catch {
    return null;
  }
};

const artStyle = (value: string) => {
  const palettes = [
    'from-neon-blue/55 via-cyan-500/20 to-slate-950',
    'from-neon-purple/60 via-fuchsia-500/15 to-slate-950',
    'from-neon-pink/55 via-orange-400/15 to-slate-950',
    'from-neon-green/45 via-teal-500/15 to-slate-950',
  ];
  const seed = [...value].reduce((total, character) => total + character.charCodeAt(0), 0);
  return palettes[seed % palettes.length];
};

const DifficultyStars = ({ value }: { value: number }) => {
  const filled = Math.max(1, Math.min(5, Math.round(value * 4) + 1));
  return <div className="flex items-center gap-0.5" aria-label={`${filled} out of 5 difficulty stars`}>
    {Array.from({ length: 5 }, (_, index) => <Star key={index} className={`h-3.5 w-3.5 ${index < filled ? 'fill-neon-orange text-neon-orange' : 'text-white/15'}`} />)}
  </div>;
};

const MapReviews = ({ songId }: { songId: string }) => {
  const [reviews, setReviews] = useState<MapReview[]>([]);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    getMapReviews(songId).then((next) => { if (active) setReviews(next); }).catch(() => { if (active) setReviews([]); });
    return () => { active = false; };
  }, [songId]);
  const average = reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : null;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const review = await saveMapReview({ songId, username: localStorage.getItem('username') || 'Player', rating, body });
      setReviews((current) => [review, ...current]); setBody('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save feedback.'); }
    finally { setBusy(false); }
  };
  return <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-neon-purple">Community feedback</p><p className="mt-1 text-sm text-white/45">{average ? `${average.toFixed(1)} / 5 from ${reviews.length} player${reviews.length === 1 ? '' : 's'}` : 'Be the first to rate this chart.'}</p></div>{average && <div className="flex items-center gap-1 text-neon-orange"><Star className="h-4 w-4 fill-current" /><span className="font-display text-xl font-black">{average.toFixed(1)}</span></div>}</div><form onSubmit={submit} className="mt-4 grid gap-2 sm:grid-cols-[auto_1fr_auto]"><select aria-label="Map rating" value={rating} onChange={(event) => setRating(Number(event.target.value))} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-xs font-bold text-neon-orange outline-none">{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} stars</option>)}</select><input value={body} onChange={(event) => setBody(event.target.value)} maxLength={400} placeholder="Leave a short review (optional)" className="min-w-0 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-neon-purple/50" /><button disabled={busy} className="rounded-xl bg-neon-purple px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-black disabled:opacity-40">{busy ? 'Saving' : 'Post'}</button></form>{error && <p className="mt-2 text-xs text-neon-pink">{error}</p>}<div className="mt-4 max-h-36 space-y-2 overflow-y-auto pr-1 custom-scrollbar">{reviews.slice(0, 8).map((review) => <div key={review.id} className="rounded-xl border border-white/5 bg-black/20 px-3 py-2"><div className="flex items-center justify-between gap-3 text-[10px]"><span className="font-bold text-white/70">{review.username}</span><span className="font-mono text-neon-orange">{'★'.repeat(review.rating)}</span></div>{review.body && <p className="mt-1 text-xs text-white/45">{review.body}</p>}</div>)}</div></section>;
};

export const SongLibrary: React.FC<SongLibraryProps> = ({
  songs,
  favoriteSongIds,
  onToggleFavorite,
  onLoadSong,
  onPreviewStart,
  onPreviewStop,
}) => {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('featured');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const favoriteSet = useMemo(() => new Set(favoriteSongIds), [favoriteSongIds]);

  const visibleSongs = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const next = songs.filter((song) => {
      const matchesQuery = !normalizedQuery || song.name.toLocaleLowerCase().includes(normalizedQuery) || song.artist.toLocaleLowerCase().includes(normalizedQuery);
      return matchesQuery && (!favoritesOnly || favoriteSet.has(song.id));
    });

    return [...next].sort((left, right) => {
      if (sort === 'top-score') return (right.topScore || 0) - (left.topScore || 0);
      if (sort === 'newest') return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
      const favoriteDifference = Number(favoriteSet.has(right.id)) - Number(favoriteSet.has(left.id));
      return favoriteDifference || (right.topScore || 0) - (left.topScore || 0);
    });
  }, [favoriteSet, favoritesOnly, query, songs, sort]);

  useEffect(() => {
    if (selectedSongId && visibleSongs.some((song) => song.id === selectedSongId)) return;
    setSelectedSongId(visibleSongs[0]?.id || null);
  }, [selectedSongId, visibleSongs]);

  const selectedSong = songs.find((song) => song.id === selectedSongId) || null;
  const selectedBest = selectedSong ? readPersonalBest(selectedSong.id) : null;

  const loadSong = (song: CommunitySongRecord) => {
    onPreviewStop();
    onLoadSong(song);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search songs or artists"
            className="w-full rounded-2xl border border-white/10 bg-black/25 py-3 pl-11 pr-10 text-sm text-white outline-none transition focus:border-neon-blue/50"
          />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear song search" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/35 transition hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>}
        </label>
        <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} aria-label="Sort songs" className="rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white/70 outline-none focus:border-neon-blue/50">
          <option value="featured">Featured</option>
          <option value="top-score">Top score</option>
          <option value="newest">Newest</option>
        </select>
        <button type="button" onClick={() => setFavoritesOnly((current) => !current)} aria-pressed={favoritesOnly} className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-xs font-black uppercase tracking-wider transition ${favoritesOnly ? 'border-neon-pink/45 bg-neon-pink/15 text-neon-pink' : 'border-white/10 bg-white/[0.04] text-white/45 hover:text-white'}`}><Heart className={`h-4 w-4 ${favoritesOnly ? 'fill-current' : ''}`} /> Favorites</button>
      </div>

      {selectedSong && <section className="overflow-hidden rounded-3xl border border-neon-blue/20 bg-gradient-to-br from-neon-blue/[0.12] via-white/[0.035] to-neon-purple/[0.08] p-4 sm:p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className={`relative flex h-28 w-full shrink-0 overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br sm:w-28 ${artStyle(`${selectedSong.name}${selectedSong.artist}`)}`}>
            {selectedSong.coverUrl ? <img src={selectedSong.coverUrl} alt={`${selectedSong.name} cover art`} className="absolute inset-0 h-full w-full object-cover" /> : <><div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_25%,rgba(255,255,255,0.35),transparent_20%),linear-gradient(135deg,transparent_45%,rgba(0,0,0,0.45))]" /><Music className="relative m-auto h-9 w-9 text-white/90" /><span className="absolute bottom-2 left-2 font-display text-xl font-black italic text-white/70">{selectedSong.name.charAt(0).toUpperCase()}</span></>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.22em] text-neon-blue">Now selected</p><h4 className="mt-1 truncate font-display text-2xl font-black text-white">{selectedSong.name}</h4><p className="mt-1 truncate text-sm text-white/45">{selectedSong.artist}</p></div><button type="button" onClick={() => onToggleFavorite(selectedSong.id)} aria-label={favoriteSet.has(selectedSong.id) ? 'Remove from favorites' : 'Add to favorites'} className={`rounded-xl border p-2.5 transition ${favoriteSet.has(selectedSong.id) ? 'border-neon-pink/40 bg-neon-pink/15 text-neon-pink' : 'border-white/10 text-white/35 hover:text-neon-pink'}`}><Heart className={`h-5 w-5 ${favoriteSet.has(selectedSong.id) ? 'fill-current' : ''}`} /></button></div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2"><DifficultyStars value={selectedSong.difficulty} /><span className="text-[10px] font-black uppercase tracking-wider text-white/35">{Math.round(selectedSong.difficulty * 100)}% intensity</span>{selectedBest && <span className="rounded-full border border-neon-green/25 bg-neon-green/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-neon-green">PB {selectedBest.score.toLocaleString()} · {selectedBest.accuracy.toFixed(1)}%</span>}{selectedSong.scores?.some((entry) => entry.username === localStorage.getItem('username') && entry.fullCombo) && <span className="rounded-full border border-neon-orange/30 bg-neon-orange/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-neon-orange">Full combo</span>}</div>
          </div>
          <div className="flex shrink-0 gap-2"><button type="button" onClick={() => onPreviewStart(selectedSong.audioUrl)} className="flex items-center gap-2 rounded-xl border border-neon-purple/30 bg-neon-purple/10 px-4 py-3 text-xs font-black uppercase tracking-wider text-neon-purple transition hover:bg-neon-purple hover:text-black"><Volume2 className="h-4 w-4" /> Preview</button><button type="button" onClick={() => loadSong(selectedSong)} className="flex items-center gap-2 rounded-xl bg-neon-blue px-4 py-3 text-xs font-black uppercase tracking-wider text-black transition hover:bg-white"><Play className="h-4 w-4 fill-current" /> Play</button></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3 text-[10px] font-bold uppercase tracking-wider text-white/45"><span>By {selectedSong.authorName || 'Anonymous'}</span><span>Chart v{selectedSong.chartVersion || 1}</span>{selectedSong.tags?.map((tag) => <span key={tag} className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[9px]">#{tag}</span>)}</div>
      </section>}
      {selectedSong && <MapReviews songId={selectedSong.id} />}

      {visibleSongs.length === 0 ? <div className="flex min-h-56 flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 px-6 text-center"><Music className="mb-3 h-8 w-8 text-white/20" /><p className="font-display font-bold text-white/60">{favoritesOnly ? 'No favorite songs yet' : query ? 'No songs match that search' : 'No songs shared yet'}</p><p className="mt-1 text-xs text-white/30">{favoritesOnly ? 'Use the heart on any map to keep it close.' : 'Upload a song to begin the collection.'}</p></div> : <div className="grid max-h-[520px] gap-3 overflow-y-auto pr-1 custom-scrollbar sm:grid-cols-2 xl:grid-cols-3">
        {visibleSongs.map((song) => {
          const best = readPersonalBest(song.id);
          const isSelected = song.id === selectedSongId;
          const isFavorite = favoriteSet.has(song.id);
          return <article key={song.id} className={`group relative overflow-hidden rounded-2xl border p-3 transition ${isSelected ? 'border-neon-blue/45 bg-neon-blue/[0.09]' : 'border-white/8 bg-black/20 hover:border-white/20 hover:bg-white/[0.06]'}`}>
            <button type="button" onClick={() => setSelectedSongId(song.id)} onMouseEnter={() => onPreviewStart(song.audioUrl)} onMouseLeave={onPreviewStop} className="flex w-full min-w-0 items-center gap-3 text-left">
              <div className={`relative flex h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br ${artStyle(`${song.name}${song.artist}`)}`}>{song.coverUrl ? <img src={song.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <><Music className="m-auto h-5 w-5 text-white/80" /><span className="absolute bottom-1 left-1.5 font-display text-sm font-black italic text-white/65">{song.name.charAt(0).toUpperCase()}</span></>}</div>
              <div className="min-w-0 flex-1"><h5 className="truncate font-display text-sm font-bold text-white">{song.name}</h5><p className="mt-0.5 truncate text-xs text-white/40">{song.artist}</p><div className="mt-2 flex items-center justify-between gap-2"><DifficultyStars value={song.difficulty} /><span className="font-mono text-[10px] text-neon-pink">{(song.topScore || 0).toLocaleString()}</span></div></div>
            </button>
            <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2.5"><span className="text-[9px] font-bold uppercase tracking-wider text-white/30">{best ? `PB ${best.score.toLocaleString()}` : 'No personal best'}</span><div className="flex items-center gap-1"><button type="button" onClick={() => onToggleFavorite(song.id)} aria-label={isFavorite ? `Remove ${song.name} from favorites` : `Favorite ${song.name}`} className={`rounded-lg p-1.5 transition ${isFavorite ? 'text-neon-pink' : 'text-white/25 hover:text-neon-pink'}`}><Heart className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} /></button><button type="button" onClick={() => loadSong(song)} aria-label={`Play ${song.name}`} className="rounded-lg bg-white/7 p-1.5 text-white/45 transition hover:bg-neon-blue hover:text-black"><Play className="h-4 w-4 fill-current" /></button></div></div>
          </article>;
        })}
      </div>}

      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white/30"><Sparkles className="h-3.5 w-3.5 text-neon-purple" /> Pick a chart, listen to a preview, then load it into the studio to play or edit.</p>
    </div>
  );
};
