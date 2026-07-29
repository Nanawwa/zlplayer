import { useState } from 'react';
import type { RoomSummary } from '../types';
import { IconVideo, IconUsers } from './Icons';

interface Props {
  rooms: RoomSummary[];
  onJoin: (code: string, password: string, name: string) => void;
  onRefresh: () => void;
  loading: boolean;
}

export default function ActiveRoomList({ rooms, onJoin, onRefresh, loading }: Props) {
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  const [nickname, setNickname] = useState(() => { try { return localStorage.getItem('zlplay_nickname') || ''; } catch { return ''; } });

  const handleJoinClick = (room: RoomSummary) => {
    if (room.memberCount === 0) return;
    setJoinCode(room.code);
    setPassword('');
  };

  const handleConfirmJoin = () => {
    if (!joinCode) return;
    try { localStorage.setItem('zlplay_nickname', nickname); } catch { /* ignore */ }
    onJoin(joinCode, password, nickname);
    setJoinCode(null);
    setPassword('');
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-sm font-semibold text-secondary">
          活跃房间 {rooms.length > 0 && `(${rooms.length})`}
        </h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className={`text-xs text-[var(--primary-500)] hover:text-[var(--primary-600)] transition-colors ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>

      {rooms.length === 0 ? (
        <div className="text-center py-16 bg-card rounded-[12px] border border-base shadow-card">
          <div className="text-secondary opacity-30 mb-3">
            <IconUsers size={40} className="mx-auto" />
          </div>
          <p className="text-sm text-secondary mb-1">暂无活跃房间</p>
          <p className="text-xs text-secondary opacity-60">创建一个房间，邀请朋友加入吧</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rooms.map((room) => (
            <div
              key={room.code}
              role="button"
              tabIndex={0}
              aria-label={`加入房间 ${room.code}${room.videoTitle ? '，正在播放 ' + room.videoTitle : ''}`}
              onClick={() => handleJoinClick(room)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleJoinClick(room); } }}
              className="group cursor-pointer bg-card rounded-[12px] border border-base p-4 shadow-card hover:border-[var(--primary-500)] hover:shadow-elevated hover:scale-[1.02] active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[var(--primary-500)] transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="font-display text-lg font-semibold text-[var(--primary-500)] tracking-wide">
                    {room.code}
                  </span>
                  <span className="ml-2 inline-flex items-center gap-1 text-sm text-secondary">
                    <IconUsers size={12} /> {room.memberCount}
                  </span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleJoinClick(room); }}
                  className="px-3 py-1 text-xs font-medium bg-[var(--primary-500)] text-white rounded-lg hover:bg-[var(--primary-600)] transition-all"
                >
                  加入
                </button>
              </div>
              {room.videoTitle ? (
                <div className="flex items-center gap-1.5 text-xs text-secondary truncate">
                  <IconVideo size={11} className="text-[var(--primary-500)] flex-shrink-0" />
                  <span className="truncate">{room.videoTitle}</span>
                </div>
              ) : (
                <div className="text-xs text-secondary opacity-60">等待选片</div>
              )}
              <div className="text-[10px] text-secondary opacity-50 mt-2">
                {room.ownerName} 的房间
              </div>
            </div>
          ))}
        </div>
      )}

      {/* join password modal */}
      {joinCode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
          onClick={() => setJoinCode(null)}
        >
          <div
            className="bg-card rounded-[16px] shadow-modal p-5 w-full max-w-xs mx-4 animate-pop-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-sm font-bold text-primary mb-1">加入房间</h3>
            <p className="text-xs text-secondary mb-4">
              房间码 <span className="font-mono font-bold text-primary">{joinCode}</span>
            </p>

            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="你的昵称"
              autoFocus
              className="w-full px-3 py-2 text-sm bg-elevated border border-base rounded-lg text-primary placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--primary-500)] mb-2 transition-colors"
            />
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirmJoin()}
              placeholder="房间密码（如需要）"
              className="w-full px-3 py-2 text-sm bg-elevated border border-base rounded-lg text-primary placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--primary-500)] mb-4 transition-colors"
            />

            <div className="flex gap-2">
              <button
                onClick={() => setJoinCode(null)}
                className="flex-1 py-2 text-xs border border-base rounded-lg text-secondary hover:bg-elevated transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmJoin}
                className="flex-1 py-2 text-xs bg-[var(--primary-500)] text-white rounded-lg hover:bg-[var(--primary-600)] transition-colors"
              >
                加入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
