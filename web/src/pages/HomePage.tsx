import { useState, useEffect, useCallback, useRef } from 'react';
import { useRoomStore } from '../store/roomStore';
import { useTheme } from '../hooks/useTheme';
import { setAlistBaseUrl, setAlistToken, login, formatAlistUrl, getAlistBaseUrl, getAlistToken } from '../utils/alistApi';
import ActiveRoomList from '../components/ActiveRoomList';
import { IconVideo, IconSun, IconMoon } from '../components/Icons';

interface HomePageProps {
  sendMessage: (type: string, payload: Record<string, unknown>) => void;
}

export default function HomePage({ sendMessage }: HomePageProps) {
  const alistUrl = useRoomStore((s) => s.alistUrl);
  const setStoreAlistUrl = useRoomStore((s) => s.setAlistUrl);
  const wsConnected = useRoomStore((s) => s.wsConnected);
  const availableRooms = useRoomStore((s) => s.availableRooms);
  const setAvailableRooms = useRoomStore((s) => s.setAvailableRooms);
  const setCurrentVideo = useRoomStore((s) => s.setCurrentVideo);
  const setPlayerState = useRoomStore((s) => s.setPlayerState);

  const [toast, setToast] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showAlistSetup, setShowAlistSetup] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [nickName, setNickName] = useState(() => { try { return localStorage.getItem('zlplay_nickname') || ''; } catch { return ''; } });
  const [alistUrlInput, setAlistUrlInput] = useState(alistUrl || (import.meta.env.VITE_DEFAULT_ALIST_URL as string) || '');
  const [alistUsername, setAlistUsername] = useState('');
  const [alistPassword, setAlistPassword] = useState('');
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [alistStatus, setAlistStatus] = useState<'checking' | 'ok' | 'guest'>('checking');
  const [roomsLoading, setRoomsLoading] = useState(false);

  const { cycle: cycleTheme, isDark } = useTheme();
  const refreshTimer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    try { localStorage.setItem('zlplay_nickname', nickName); } catch { /* ignore */ }
  }, [nickName]);

  // 自动检测 Alist 连接状态
  useEffect(() => {
    if (!alistUrl) { setAlistStatus('guest'); return; }
    setAlistStatus('checking');
    const token = getAlistToken();
    if (!token) { setAlistStatus('guest'); return; }
    // 尝试调用 /api/me 验证 token
    fetch(`${alistUrl}/api/me`, { headers: { Authorization: token } })
      .then(r => r.json())
      .then(d => setAlistStatus(d.code === 200 ? 'ok' : 'guest'))
      .catch(() => setAlistStatus('guest'));
  }, [alistUrl]);

  // 定时刷新房间列表
  const fetchRooms = useCallback(() => {
    if (!wsConnected) return;
    setRoomsLoading(true);
    sendMessage('list_rooms', {});
    setTimeout(() => setRoomsLoading(false), 2000);
  }, [wsConnected, sendMessage]);

  useEffect(() => {
    if (!wsConnected) return;
    fetchRooms();
    refreshTimer.current = setInterval(fetchRooms, 30000);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [wsConnected, fetchRooms]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const connectAlist = useCallback(async () => {
    const formatted = formatAlistUrl(alistUrlInput);
    if (!formatted) { setConnectError('请输入服务器地址'); return; }
    setConnectLoading(true);
    setConnectError(null);
    setAlistBaseUrl(formatted);
    if (alistUsername && alistPassword) {
      try {
        const result = await login(alistUsername, alistPassword);
        setAlistToken(result.token);
        setStoreAlistUrl(formatted);
        setAlistStatus('ok');
        setShowAlistSetup(false);
      } catch (e) {
        setConnectError(e instanceof Error ? e.message : '登录失败');
      }
    } else {
      setStoreAlistUrl(formatted);
      setAlistStatus('guest');
      setShowAlistSetup(false);
    }
    setConnectLoading(false);
  }, [alistUrlInput, alistUsername, alistPassword, setStoreAlistUrl]);

  const handleCreateRoom = useCallback(() => {
    if (!wsConnected) { showToast('未连接到服务器'); return; }
    sendMessage('create_room', { password: roomPassword, name: nickName || undefined });
    setShowCreateModal(false);
  }, [sendMessage, roomPassword, nickName, wsConnected, showToast]);

  const handleJoinRoom = useCallback((code: string, password: string, name?: string) => {
    if (!code.trim()) return;
    if (!wsConnected) { showToast('未连接到服务器'); return; }
    setCurrentVideo(null);
    setPlayerState({ playing: false, position: 0, timestamp: Date.now() });
    const displayName = name || nickName || undefined;
    if (displayName) { try { localStorage.setItem('zlplay_nickname', displayName); } catch { /* ignore */ } }
    sendMessage('join_room', { code: code.toUpperCase(), password, name: displayName });
    setShowJoinModal(false);
  }, [sendMessage, nickName, wsConnected, showToast, setCurrentVideo, setPlayerState]);

  const handleJoinFromModal = useCallback(() => {
    handleJoinRoom(joinCode, joinPassword);
  }, [joinCode, joinPassword, handleJoinRoom]);

  const handleRefreshRooms = useCallback(() => {
    setAvailableRooms([]);
    fetchRooms();
  }, [fetchRooms, setAvailableRooms]);

  const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400';

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-950 flex flex-col overflow-hidden">
      <header className="flex-shrink-0 flex items-center gap-2 px-3 h-12 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
        <span className="text-sm font-bold text-gray-800 dark:text-gray-200">ZlPlay</span>

        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ml-1 ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`} />

        {/* Alist status */}
        {alistStatus === 'checking' ? (
          <span className="text-[11px] text-gray-400 hidden sm:inline">检测中...</span>
        ) : alistStatus === 'ok' ? (
          <span className="text-[11px] text-green-500 hidden sm:inline cursor-pointer" onClick={() => setShowAlistSetup(true)}>已连接</span>
        ) : (
          <button onClick={() => setShowAlistSetup(true)}
            className="text-[11px] text-amber-500 hover:text-amber-600 hidden sm:inline">
            {alistUrl ? '访客模式' : '连接 Alist'}
          </button>
        )}

        <div className="flex-1" />

        <button onClick={cycleTheme} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors">
          {isDark ? <IconSun size={15} /> : <IconMoon size={15} />}
        </button>

        <button onClick={() => setShowCreateModal(true)} disabled={!wsConnected}
          className="px-3 py-1.5 bg-blue-500 text-white text-xs font-medium rounded-md hover:bg-blue-600 disabled:opacity-40 transition-colors">
          创建房间
        </button>
        <button onClick={() => setShowJoinModal(true)} disabled={!wsConnected}
          className="px-3 py-1.5 border border-blue-500 text-blue-500 text-xs font-medium rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-40 transition-colors">
          加入房间
        </button>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
        {/* Alist setup */}
        {showAlistSetup && (
          <div className="mb-6 max-w-md mx-auto p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Alist 服务器</h3>
              <button onClick={() => setShowAlistSetup(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm">×</button>
            </div>
            {connectError && (
              <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400 text-xs">{connectError}</div>
            )}
            <input type="text" value={alistUrlInput}
              onChange={e => { setAlistUrlInput(e.target.value); setConnectError(null); }}
              placeholder="https://alist.example.com" className={`${inputCls} mb-2`} />
            <div className="grid grid-cols-2 gap-2 mb-3">
              <input type="text" value={alistUsername} onChange={e => setAlistUsername(e.target.value)} placeholder="用户名" className={inputCls} />
              <input type="password" value={alistPassword} onChange={e => setAlistPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && connectAlist()} placeholder="密码" className={inputCls} />
            </div>
            <button onClick={connectAlist} disabled={connectLoading}
              className="w-full py-2 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors">
              {connectLoading ? '连接中...' : (alistUsername ? '登录' : '连接（访客）')}
            </button>
          </div>
        )}

        {/* Room list */}
        {wsConnected ? (
          <ActiveRoomList
            rooms={availableRooms}
            onJoin={handleJoinRoom}
            onRefresh={handleRefreshRooms}
            loading={roomsLoading}
          />
        ) : (
          <div className="max-w-md mx-auto text-center py-16">
            <IconVideo size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-gray-400 dark:text-gray-500 text-sm">正在连接服务器...</p>
            <p className="text-gray-400 dark:text-gray-600 text-xs mt-1">连接后可创建或加入房间</p>
          </div>
        )}
      </main>

      {/* create room modal */}
      {showCreateModal && (
        <Modal onClose={() => setShowCreateModal(false)} title="创建房间">
          <div className="space-y-3">
            <Field label="昵称" value={nickName} onChange={setNickName} placeholder="你的昵称" />
            <Field label="房间密码（可选）" value={roomPassword} onChange={setRoomPassword} placeholder="留空则公开" />
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => setShowCreateModal(false)} className="flex-1 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">取消</button>
            <button onClick={handleCreateRoom} className="flex-1 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">创建</button>
          </div>
        </Modal>
      )}

      {/* join room modal */}
      {showJoinModal && (
        <Modal onClose={() => setShowJoinModal(false)} title="加入房间">
          <div className="space-y-3">
            <Field label="昵称" value={nickName} onChange={setNickName} placeholder="你的昵称" />
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">房间码</label>
              <input type="text" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
                placeholder="6位房间码" maxLength={6} autoFocus
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase tracking-widest text-center text-lg font-mono" />
            </div>
            <Field label="密码（如需要）" value={joinPassword} onChange={setJoinPassword} placeholder="房间密码" />
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => setShowJoinModal(false)} className="flex-1 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">取消</button>
            <button onClick={handleJoinFromModal} className="flex-1 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">加入</button>
          </div>
        </Modal>
      )}

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 bg-gray-800 text-white text-xs rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      <footer className="text-center py-3 text-[10px] text-gray-300 dark:text-gray-700 flex-shrink-0">
        ZlPlay &copy; {new Date().getFullYear()} &middot; 异地同步观影
      </footer>
    </div>
  );
}

function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl p-5 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400" />
    </div>
  );
}
