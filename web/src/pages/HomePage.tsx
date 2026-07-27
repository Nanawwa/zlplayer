import { useState, useEffect, useCallback } from 'react';
import { useRoomStore } from '../store/roomStore';
import { useTheme } from '../hooks/useTheme';
import { setAlistBaseUrl, setAlistToken, login, formatAlistUrl, getAlistBaseUrl } from '../utils/alistApi';
import FileBrowser from '../components/FileBrowser';

interface HomePageProps {
  sendMessage: (type: string, payload: Record<string, unknown>) => void;
}

/**
 * 首页：视频列表 + 创建/加入房间
 */
export default function HomePage({ sendMessage }: HomePageProps) {
  // Alist 设置
  const alistUrl = useRoomStore((s) => s.alistUrl);
  const setStoreAlistUrl = useRoomStore((s) => s.setAlistUrl);
  const setCurrentVideo = useRoomStore((s) => s.setCurrentVideo);
  const setPlayerState = useRoomStore((s) => s.setPlayerState);

  // Alist 连接错误
  const [connectError, setConnectError] = useState<string | null>(null);

  // 房间弹窗
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [nickName, setNickName] = useState(() => {
    try {
      return localStorage.getItem('zlplay_nickname') || '';
    } catch {
      return '';
    }
  });
  const defaultAlist = (import.meta.env.VITE_DEFAULT_ALIST_URL as string) || '';
  const [alistUrlInput, setAlistUrlInput] = useState(alistUrl || defaultAlist);
  const [alistUsername, setAlistUsername] = useState('');
  const [alistPassword, setAlistPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const { cycle: cycleTheme, icon: themeIcon } = useTheme();

  // 保存昵称
  useEffect(() => {
    try {
      localStorage.setItem('zlplay_nickname', nickName);
    } catch { /* ignore */ }
  }, [nickName]);

  // 连接 Alist（支持 Token 或用户名密码登录）
  const connectAlist = useCallback(async () => {
    const formatted = formatAlistUrl(alistUrlInput);
    if (!formatted) {
      setConnectError('请输入 Alist 服务器地址');
      return;
    }

    setConnectError(null);
    setAlistBaseUrl(formatted);

    // 如果提供了用户名和密码，先登录获取 token
    if (alistUsername && alistPassword) {
      setLoginLoading(true);
      try {
        const result = await login(alistUsername, alistPassword);
        setAlistToken(result.token);
        setStoreAlistUrl(formatted);
        setConnectError(null);
      } catch (e) {
        setConnectError(`登录失败: ${e instanceof Error ? e.message : '未知错误'}`);
        setLoginLoading(false);
        return;
      }
      setLoginLoading(false);
    } else {
      setStoreAlistUrl(formatted);
    }
  }, [alistUrlInput, alistUsername, alistPassword, setStoreAlistUrl]);

  // 选中视频：先设置本地状态，等进入房间后再广播
  const handlePlayVideo = useCallback(
    (url: string, title: string) => {
      setCurrentVideo({ url, title });
      setPlayerState({ playing: false, position: 0, timestamp: Date.now() });
      // 不在 HomePage 发 WS，RoomPage 进入时会补发
    },
    [setCurrentVideo, setPlayerState]
  );

  // 创建房间
  const handleCreateRoom = useCallback(() => {
    sendMessage('create_room', {
      password: roomPassword,
      name: nickName || undefined,
    });
    setShowCreateModal(false);
  }, [sendMessage, roomPassword, nickName]);

  // 加入房间
  const handleJoinRoom = useCallback(() => {
    if (!roomCode.trim()) return;
    sendMessage('join_room', {
      code: roomCode.toUpperCase(),
      password: roomPassword,
      name: nickName || undefined,
    });
    setShowJoinModal(false);
  }, [sendMessage, roomCode, roomPassword, nickName]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* 顶部导航 */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-primary-500">🎬 ZlPlay</h1>

          <div className="flex items-center gap-3">
            <button onClick={cycleTheme} className="text-lg px-1" title="切换主题">{themeIcon}</button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary-500 text-white text-sm font-medium rounded-lg hover:bg-primary-600 transition-colors"
            >
              + 创建房间
            </button>
            <button
              onClick={() => setShowJoinModal(true)}
              className="px-4 py-2 border border-primary-500 text-primary-500 text-sm font-medium rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
            >
              加入房间
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Alist 连接设置 */}
        {!alistUrl && (
          <div className="mb-6 p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">
              🔗 连接 Alist 服务器
            </h2>

            {connectError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
                {connectError}
              </div>
            )}

            <div className="space-y-3">
              {/* 服务器地址 */}
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                  服务器地址
                </label>
                <input
                  type="text"
                  value={alistUrlInput}
                  onChange={(e) => {
                    setAlistUrlInput(e.target.value);
                    setConnectError(null);
                  }}
                  onBlur={() => {
                    // 自动格式化：离开输入框时补全协议
                    if (alistUrlInput.trim() && !/^https?:\/\//i.test(alistUrlInput.trim())) {
                      setAlistUrlInput('https://' + alistUrlInput.trim());
                    }
                  }}
                  placeholder={defaultAlist || "输入 Alist 地址，如 https://alist.example.com"}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-400 mt-1">输入域名即可，自动补全 https://</p>
              </div>

              {/* 用户名密码登录 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                    用户名
                  </label>
                  <input
                    type="text"
                    value={alistUsername}
                    onChange={(e) => setAlistUsername(e.target.value)}
                    placeholder="Alist 用户名"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                    密码
                  </label>
                  <input
                    type="password"
                    value={alistPassword}
                    onChange={(e) => setAlistPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && connectAlist()}
                    placeholder="Alist 密码"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              <button
                onClick={connectAlist}
                disabled={loginLoading}
                className="w-full px-6 py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-60 transition-colors font-medium"
              >
                {loginLoading ? '登录中...' : (alistUsername ? '登录并连接' : '连接（访客模式）')}
              </button>
            </div>
          </div>
        )}

        {/* 已连接 Alist 时显示设置 */}
        {alistUrl && (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <span>📡 {alistUrl}</span>
            <button
              onClick={() => {
                setStoreAlistUrl('');
                setAlistUrlInput(defaultAlist);
                setAlistUsername('');
                setAlistPassword('');
              }}
              className="text-primary-500 hover:underline"
            >
              更换
            </button>
          </div>
        )}

        {/* 文件浏览器 */}
        {alistUrl && (
          <div className="min-h-[400px]">
            <FileBrowser onPlayVideo={handlePlayVideo} />
          </div>
        )}
      </main>

      {/* ── 创建房间弹窗 ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold mb-4 text-gray-800 dark:text-gray-200">
              🏠 创建新房间
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                  你的昵称
                </label>
                <input
                  type="text"
                  value={nickName}
                  onChange={(e) => setNickName(e.target.value)}
                  placeholder="输入昵称"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                  房间密码（可选，留空则无密码）
                </label>
                <input
                  type="text"
                  value={roomPassword}
                  onChange={(e) => setRoomPassword(e.target.value)}
                  placeholder="设置房间密码"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreateRoom}
                className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 加入房间弹窗 ── */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold mb-4 text-gray-800 dark:text-gray-200">
              🚪 加入房间
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                  你的昵称
                </label>
                <input
                  type="text"
                  value={nickName}
                  onChange={(e) => setNickName(e.target.value)}
                  placeholder="输入昵称"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                  房间码（6位）
                </label>
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="输入房间码"
                  maxLength={6}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500 uppercase tracking-widest text-center text-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                  房间密码（如需要）
                </label>
                <input
                  type="text"
                  value={roomPassword}
                  onChange={(e) => setRoomPassword(e.target.value)}
                  placeholder="输入房间密码"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowJoinModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleJoinRoom}
                className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium"
              >
                加入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 设置按钮 ── */}
      {!alistUrl && (
        <div className="fixed bottom-6 right-6">
          <button
            onClick={() => {
              setAlistUrlInput('https://alist.example.com');
            }}
            className="w-12 h-12 bg-gray-800 dark:bg-gray-700 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-gray-700 transition-colors"
            title="设置"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
