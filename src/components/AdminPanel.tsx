import React from 'react';
import { Upload, Save, Lock, Trash2, Edit2, Check, X, RefreshCw } from 'lucide-react';
import { GlobalScoreRecord } from '../services/pulseApi';
import { IntegrityResultRow, MainTab } from './menuShared';

export interface AdminPanelProps {
  adminPassword: string;
  adminToken: string | null;
  chartRebuildStatus: string | null;
  communitySongs: any[];
  editForm: { name: string; artist: string; difficulty: number; density: number; laneVariety: number; sliderProbability: number; stamina: number; };
  editingSong: any | null;
  fetchMoreGlobalScores: () => Promise<void>;
  globalScores: GlobalScoreRecord[];
  handleAdminLogin: (e: React.FormEvent<Element>) => Promise<void>;
  handleAdminLogout: () => void;
  handleChangeAdminPassword: (e: React.FormEvent<Element>) => Promise<void>;
  handleDeleteSong: (id: string) => Promise<void>;
  handleForceStorageUpdate: () => Promise<void>;
  handleMainTabChange: (tab: MainTab) => void;
  handleRebuildOutdatedCharts: () => Promise<void>;
  handleUpdateSong: (id: string) => Promise<void>;
  hasMoreScores: boolean;
  integrityResults: IntegrityResultRow[] | null;
  isAdminLoading: boolean;
  isChangingPassword: boolean;
  isCheckingIntegrity: boolean;
  isForcingStorageUpdate: boolean;
  isLoadingMoreScores: boolean;
  isModeratingLeaderboard: boolean;
  loadingSongId: string | null;
  newAdminPassword: string;
  openLeaderboardRemoval: (score: GlobalScoreRecord) => void;
  outdatedChartSongs: any[];
  runIntegrityCheck: () => Promise<void>;
  setAdminPassword: React.Dispatch<React.SetStateAction<string>>;
  setEditForm: React.Dispatch<React.SetStateAction<{ name: string; artist: string; difficulty: number; density: number; laneVariety: number; sliderProbability: number; stamina: number; }>>;
  setEditingSong: React.Dispatch<any>;
  setIntegrityResults: React.Dispatch<React.SetStateAction<IntegrityResultRow[]>>;
  setIsChangingPassword: React.Dispatch<React.SetStateAction<boolean>>;
  setNewAdminPassword: React.Dispatch<React.SetStateAction<string>>;
  startEditingSong: (song: any) => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  adminPassword,
  adminToken,
  chartRebuildStatus,
  communitySongs,
  editForm,
  editingSong,
  fetchMoreGlobalScores,
  globalScores,
  handleAdminLogin,
  handleAdminLogout,
  handleChangeAdminPassword,
  handleDeleteSong,
  handleForceStorageUpdate,
  handleMainTabChange,
  handleRebuildOutdatedCharts,
  handleUpdateSong,
  hasMoreScores,
  integrityResults,
  isAdminLoading,
  isChangingPassword,
  isCheckingIntegrity,
  isForcingStorageUpdate,
  isLoadingMoreScores,
  isModeratingLeaderboard,
  loadingSongId,
  newAdminPassword,
  openLeaderboardRemoval,
  outdatedChartSongs,
  runIntegrityCheck,
  setAdminPassword,
  setEditForm,
  setEditingSong,
  setIntegrityResults,
  setIsChangingPassword,
  setNewAdminPassword,
  startEditingSong,
}) => (
      <>{
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
                        onClick={handleRebuildOutdatedCharts}
                        disabled={Boolean(chartRebuildStatus) || outdatedChartSongs.length === 0}
                        title={chartRebuildStatus || 'Regenerate official charts made with an older chart generator'}
                        className={`text-xs uppercase tracking-widest flex items-center gap-1 ${
                          chartRebuildStatus || outdatedChartSongs.length === 0 ? 'text-white/20' : 'text-neon-blue hover:text-white'
                        }`}
                      >
                        <RefreshCw className={`w-3 h-3 ${chartRebuildStatus ? 'animate-spin' : ''}`} />
                        {chartRebuildStatus ?? `Rebuild Charts (${outdatedChartSongs.length})`}
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
      }</>
);
