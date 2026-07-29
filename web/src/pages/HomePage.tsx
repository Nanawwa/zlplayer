import { useState, useEffect, useCallback, useRef } from 'react';
import { useRoomStore } from '../store/roomStore';
import { useTheme } from '../hooks/useTheme';
import { setAlistBaseUrl, setAlistToken, login, formatAlistUrl } from '../utils/alistApi';
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
  const setStoreRoomPassword = useRoomStore((s) => s.setRoomPassword);

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
  const [recentRooms] = useState<{ code: string; ts: number }[]>(() => {
    try { const r = localStorage.getItem('zlplay_recent_rooms'); return r ? JSON.parse(r) : []; } catch { return []; }
  });

  const saveRecentRoom = useCallback((code: string) => {
    try {
      const r: { code: string; ts: number }[] = (() => { const t = localStorage.getItem('zlplay_recent_rooms'); return t ? JSON.parse(t) : []; })();
      const f = r.filter((e) => e.code !== code);
      f.unshift({ code, ts: Date.now() });
      if (f.length > 10) f.length = 10;
      localStorage.setItem('zlplay_recent_rooms', JSON.stringify(f));
    } catch { /* ignore */ }
  }, []);

  const { cycle: cycleTheme, isDark } = useTheme();
  const refreshTimer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    try { localStorage.setItem('zlplay_nickname', nickName); } catch { /* ignore */ }
  }, [nickName]);

  // 自动检测 Alist 连接状态
  useEffect(() => {
    if (!alistUrl) { setAlistStatus('guest'); return; }
    setAlistStatus('checking');
    const token = (() => { try { return localStorage.getItem('zlplay_alist_token') || ''; } catch { return ''; } })();
    if (!token) { setAlistStatus('guest'); return; }
    fetch(`${alistUrl}/api/me`, { headers: { Authorization: token } })
      .then((r) => r.json())
      .then((d) => setAlistStatus(d.code === 200 ? 'ok' : 'guest'))
      .catch(() => setAlistStatus('guest'));
  }, [alistUrl]);

  // 定时刷新房间列表（收到 room_list 时自动关 loading）
  const fetchRooms = useCallback(() => {
    if (!wsConnected) return;
    setRoomsLoading(true);
    sendMessage('list_rooms', {});
  }, [wsConnected, sendMessage]);

  useEffect(() => {
    if (!wsConnected) return;
    fetchRooms();
    refreshTimer.current = setInterval(fetchRooms, 30000);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [wsConnected, fetchRooms]);

  // 收到房间列表后关闭 loading
  useEffect(() => {
    setRoomsLoading(false);
  }, [availableRooms]);

  // URL 参数自动加入房间（邀请链接）
  useEffect(() => {
    if (!wsConnected) return;
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (!room) return;
    const pwd = params.get('pwd') || '';
    // 清除 URL 参数避免重复触发
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    url.searchParams.delete('pwd');
    window.history.replaceState({}, '', url.toString());
    handleJoinRoom(room.toUpperCase(), pwd);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsConnected]);

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
    setStoreRoomPassword(roomPassword);
    setShowCreateModal(false);
  }, [sendMessage, roomPassword, nickName, wsConnected, showToast, setStoreRoomPassword]);

  const handleJoinRoom = useCallback((code: string, password: string, name?: string) => {
    if (!code.trim()) return;
    if (!wsConnected) { showToast('未连接到服务器'); return; }
    setCurrentVideo(null);
    setPlayerState({ playing: false, position: 0, timestamp: Date.now() });
    const displayName = name || nickName || undefined;
    if (displayName) { try { localStorage.setItem('zlplay_nickname', displayName); } catch { /* ignore */ } }
    saveRecentRoom(code.toUpperCase());
    sendMessage('join_room', { code: code.toUpperCase(), password, name: displayName });
    if (password) setStoreRoomPassword(password);
    setShowJoinModal(false);
  }, [sendMessage, nickName, wsConnected, showToast, setCurrentVideo, setPlayerState, setStoreRoomPassword, saveRecentRoom]);

  const handleJoinFromModal = useCallback(() => {
    handleJoinRoom(joinCode, joinPassword);
  }, [joinCode, joinPassword, handleJoinRoom]);

  const handleRefreshRooms = useCallback(() => {
    setAvailableRooms([]);
    fetchRooms();
  }, [fetchRooms, setAvailableRooms]);

  return (
    <div className="h-screen bg-base bg-grid flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
      {/* Header */}
      <header className="flex-shrink-0 flex items-center gap-2 px-4 h-12 bg-card border-b border-base">
        <span className="w-2 h-2 rounded-full bg-[var(--primary-500)] flex-shrink-0" />
        <span className="font-display text-sm font-bold text-primary">ZlPlay</span>

        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ml-1 ${wsConnected ? 'bg-[#22C55E]' : 'bg-[#EF4444]'}`} />

        {/* Alist status */}
        {alistStatus === 'checking' ? (
          <span className="text-[11px] text-secondary hidden sm:inline">检测中...</span>
        ) : alistStatus === 'ok' ? (
          <span className="text-[11px] text-[#22C55E] hidden sm:inline cursor-pointer" onClick={() => setShowAlistSetup(true)}>已连接</span>
        ) : (
          <button onClick={() => setShowAlistSetup(true)}
            className="text-[11px] text-[#EAB308] hover:text-[#CA8A04] hidden sm:inline">
            {alistUrl ? '访客模式' : '连接 Alist'}
          </button>
        )}

        <div className="flex-1" />

        <button onClick={cycleTheme} className="p-1.5 text-secondary hover:text-primary rounded-lg hover:bg-elevated transition-colors">
          {isDark ? <IconSun size={15} /> : <IconMoon size={15} />}
        </button>

        <button onClick={() => setShowCreateModal(true)} disabled={!wsConnected}
          className="px-3.5 py-1.5 bg-[var(--primary-500)] text-white text-xs font-medium rounded-lg hover:bg-[var(--primary-600)] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100 transition-all">
          创建房间
        </button>
        <button onClick={() => setShowJoinModal(true)} disabled={!wsConnected}
          className="px-3.5 py-1.5 border border-[var(--primary-500)] text-[var(--primary-500)] text-xs font-medium rounded-lg hover:bg-[var(--primary-500)]/10 disabled:opacity-40 transition-all">
          加入房间
        </button>
      </header>

      {/* Main */}
      <main className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
        {/* Alist setup */}
        {showAlistSetup && (
          <div className="mb-6 max-w-md mx-auto p-4 bg-elevated rounded-[12px] border border-base shadow-card animate-pop-in">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-sm font-semibold text-primary">Alist 服务器</h3>
              <button onClick={() => setShowAlistSetup(false)}
                className="text-secondary hover:text-primary text-lg leading-none">×</button>
            </div>
            {connectError && (
              <div className="mb-3 p-2 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg text-[#EF4444] text-xs">
                {connectError}
              </div>
            )}
            <input type="text" value={alistUrlInput}
              onChange={(e) => { setAlistUrlInput(e.target.value); setConnectError(null); }}
              placeholder="https://alist.example.com"
              className="w-full px-3 py-2 text-sm bg-card border border-base rounded-lg text-primary placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--primary-500)] mb-2 transition-colors" />
            <div className="grid grid-cols-2 gap-2 mb-3">
              <input type="text" value={alistUsername} onChange={(e) => setAlistUsername(e.target.value)} placeholder="用户名"
                className="w-full px-3 py-2 text-sm bg-card border border-base rounded-lg text-primary placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--primary-500)] transition-colors" />
              <input type="password" value={alistPassword} onChange={(e) => setAlistPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && connectAlist()} placeholder="密码"
                className="w-full px-3 py-2 text-sm bg-card border border-base rounded-lg text-primary placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--primary-500)] transition-colors" />
            </div>
            <button onClick={connectAlist} disabled={connectLoading}
              className="w-full py-2 bg-[var(--primary-500)] text-white text-sm rounded-lg hover:bg-[var(--primary-600)] hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 transition-all">
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
            <IconVideo size={48} className="mx-auto text-secondary opacity-40 mb-4" />
            <p className="text-secondary text-sm">正在连接服务器...</p>
            <p className="text-secondary text-xs mt-1 opacity-60">连接后可创建或加入房间</p>
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
          <div className="flex gap-2 mt-5">
            <button onClick={() => setShowCreateModal(false)} className="flex-1 py-2 text-xs border border-base rounded-lg text-secondary hover:bg-elevated transition-colors">取消</button>
            <button onClick={handleCreateRoom} className="flex-1 py-2 text-xs bg-[var(--primary-500)] text-white rounded-lg hover:bg-[var(--primary-600)] transition-colors">创建</button>
          </div>
        </Modal>
      )}

      {/* join room modal */}
      {showJoinModal && (
        <Modal onClose={() => setShowJoinModal(false)} title="加入房间">
          <div className="space-y-3">
            <Field label="昵称" value={nickName} onChange={setNickName} placeholder="你的昵称" />
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">房间码</label>
              <input type="text" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="6位房间码" maxLength={6} autoFocus
                className="w-full px-3 py-2.5 text-lg font-mono text-center tracking-widest uppercase border border-base rounded-lg bg-card text-primary focus:outline-none focus:border-[var(--primary-500)] transition-colors" />
            </div>
            <Field label="密码（如需要）" value={joinPassword} onChange={setJoinPassword} placeholder="房间密码" />
            {recentRooms.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">最近房间</label>
                <div className="flex flex-wrap gap-1.5">
                  {recentRooms.slice(0, 5).map((r) => (
                    <button key={r.code}
                      onClick={() => { setJoinCode(r.code); }}
                      className="px-2.5 py-1 text-[10px] font-mono font-bold text-[var(--primary-500)] bg-[var(--primary-500)]/10 hover:bg-[var(--primary-500)]/20 rounded-lg transition-colors"
                    >{r.code}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={() => setShowJoinModal(false)} className="flex-1 py-2 text-xs border border-base rounded-lg text-secondary hover:bg-elevated transition-colors">取消</button>
            <button onClick={handleJoinFromModal} className="flex-1 py-2 text-xs bg-[var(--primary-500)] text-white rounded-lg hover:bg-[var(--primary-600)] transition-colors">加入</button>
          </div>
        </Modal>
      )}

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 bg-card text-primary text-xs rounded-lg shadow-elevated border border-base animate-fade-in">
          {toast}
        </div>
      )}

      <footer className="text-center py-3 pb-safe text-[10px] text-secondary opacity-60 flex-shrink-0">
        ZlPlay &copy; {new Date().getFullYear()} · 异地同步观影
      </footer>
    </div>
  );
}

function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  const modalRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // 记住当前焦点，focus 首个 input
    prevFocusRef.current = document.activeElement as HTMLElement;
    const firstInput = modalRef.current?.querySelector<HTMLInputElement>('input, button');
    firstInput?.focus();
    return () => {
      document.body.style.overflow = prev;
      prevFocusRef.current?.focus();
    };
  }, []);

  // Escape 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label={title}
        className="bg-card rounded-[16px] shadow-modal p-5 w-full max-w-sm mx-4 animate-pop-in"
        onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-sm font-bold text-primary mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-secondary mb-1.5">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 text-sm bg-card border border-base rounded-lg text-primary placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--primary-500)] transition-colors" />
    </div>
  );
}
