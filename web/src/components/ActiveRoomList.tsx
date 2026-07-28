import { useState } from 'react';
import type { RoomSummary } from '../types';
import { IconVideo, IconUsers, IconCopy } from './Icons';

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
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400">
          活跃房间 {rooms.length > 0 && `(${rooms.length})`}
        </h2>
        <button onClick={onRefresh} disabled={loading}
          className={`text-xs text-blue-500 hover:text-blue-600 transition-colors ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}>
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>

      {rooms.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="text-gray-300 dark:text-gray-600 mb-2">
            <IconUsers size={40} className="mx-auto opacity-30" />
          </div>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">暂无活跃房间</p>
          <p className="text-xs text-gray-400 dark:text-gray-600">创建一个房间，邀请朋友加入吧</p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rooms.map(room => (
            <div key={room.code}
              className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3 hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="text-sm font-mono font-bold tracking-wider text-gray-800 dark:text-gray-200">
                    {room.code}
                  </span>
                  <span className="ml-2 inline-flex items-center gap-1 text-xs text-gray-400">
                    <IconUsers size={12} /> {room.memberCount}
                  </span>
                </div>
                <button onClick={() => handleJoinClick(room)}
                  className="px-3 py-1 text-xs font-medium bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors">
                  加入
                </button>
              </div>
              {room.videoTitle ? (
                <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                  <IconVideo size={11} className="text-blue-400 flex-shrink-0" />
                  {room.videoTitle}
                </div>
              ) : (
                <div className="text-xs text-gray-400 dark:text-gray-500">等待选片</div>
              )}
              <div className="text-[10px] text-gray-400 dark:text-gray-600 mt-1">
                {room.ownerName} 的房间
              </div>
            </div>
          ))}
        </div>
      )}

      {/* join password modal */}
      {joinCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setJoinCode(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl p-5 w-full max-w-xs mx-4"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">加入房间</h3>
            <p className="text-xs text-gray-500 mb-3">
              房间码 <span className="font-mono font-bold text-gray-700 dark:text-gray-300">{joinCode}</span>
            </p>
            <input type="text" value={nickname} onChange={e => setNickname(e.target.value)}
              placeholder="你的昵称" autoFocus
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2" />
            <input type="text" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleConfirmJoin()}
              placeholder="房间密码（如需要）"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3" />
            <div className="flex gap-2">
              <button onClick={() => setJoinCode(null)}
                className="flex-1 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">取消</button>
              <button onClick={handleConfirmJoin}
                className="flex-1 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">加入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
