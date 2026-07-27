import { useState, useEffect, useCallback, useRef } from 'react';
import { useRoomStore } from '../store/roomStore';
import { useSync } from '../hooks/useSync';
import type { PlayerAPI } from '../hooks/useSync';
import { useTheme } from '../hooks/useTheme';
import VideoPlayer from '../components/VideoPlayer';
import ChatBox from '../components/ChatBox';
import RoomList from '../components/RoomList';
import FileBrowser from '../components/FileBrowser';
import SyncIndicator from '../components/SyncIndicator';

interface RoomPageProps {
  sendMessage: (type: string, payload: Record<string, unknown>) => void;
  syncHandlerRef: React.MutableRefObject<((cmd: any) => void) | undefined>;
}

type MobilePanel = 'members' | 'chat' | 'videos' | null;

export default function RoomPage({ sendMessage, syncHandlerRef }: RoomPageProps) {
  const roomCode = useRoomStore((s) => s.roomCode);
  const isOwner = useRoomStore((s) => s.isOwner);
  const currentVideo = useRoomStore((s) => s.currentVideo);
  const wsConnected = useRoomStore((s) => s.wsConnected);
  const wsError = useRoomStore((s) => s.wsError);
  const myId = useRoomStore((s) => s.myId);
  const resetRoom = useRoomStore((s) => s.resetRoom);
  const currentPage = useRoomStore((s) => s.currentPage);
  const setCurrentVideo = useRoomStore((s) => s.setCurrentVideo);
  const setPlayerState = useRoomStore((s) => s.setPlayerState);
  const members = useRoomStore((s) => s.members);

  const { cycle: cycleTheme, icon: themeIcon } = useTheme();

  // ── 新同步引擎 ──
  const {
    status: syncStatus,
    deviation,
    registerPlayer,
    handleRemoteCommand,
    onRoomEnter,
    onRoomLeave,
    handlePlayerPlay,
    handlePlayerPause,
    handlePlayerSeeked,
  } = useSync({ sendMessage, myId, connected: wsConnected });

  // 桥接：将 useSync 的消息处理器注册到 useWebSocket 的回调
  useEffect(() => {
    syncHandlerRef.current = handleRemoteCommand;
    return () => { syncHandlerRef.current = undefined; };
  }, [syncHandlerRef, handleRemoteCommand]);

  // 进入/离开房间
  useEffect(() => { onRoomEnter(); return () => onRoomLeave(); }, [onRoomEnter, onRoomLeave]);

  // Desktop: side panel toggles; Mobile: bottom sheet overlay
  const [showMembers, setShowMembers] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);

  // track video source changes
  useEffect(() => {
    if (currentVideo?.url) setVideoSrc(currentVideo.url);
  }, [currentVideo]);

  // send video on room entry if pre-selected
  const prevRoomRef = useRef('');
  useEffect(() => {
    if (roomCode && prevRoomRef.current !== roomCode && currentVideo) {
      sendMessage('change_video', { url: currentVideo.url, title: currentVideo.title });
    }
    prevRoomRef.current = roomCode;
  }, [roomCode, currentVideo, sendMessage]);

  const handleLeave = useCallback(() => {
    sendMessage('leave_room', {});
    resetRoom();
  }, [sendMessage, resetRoom]);

  const handleDestroy = useCallback(() => {
    if (!confirm('确定解散房间？')) return;
    sendMessage('destroy_room', {});
    resetRoom();
  }, [sendMessage, resetRoom]);

  const handlePlayVideo = useCallback(
    (url: string, title: string) => {
      setCurrentVideo({ url, title });
      setPlayerState({ playing: false, position: 0, timestamp: Date.now() });
      sendMessage('change_video', { url, title });
      setShowFileBrowser(false);
      setMobilePanel(null);
    },
    [sendMessage, setCurrentVideo, setPlayerState]
  );

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(roomCode).catch(() => {
      const el = document.createElement('input');
      el.value = roomCode;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    });
  }, [roomCode]);

  if (currentPage !== 'room') return null;

  // ── shared panel content ──
  const fileBrowserPanel = (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">📁 视频库</h3>
        <button onClick={() => { setShowFileBrowser(false); setMobilePanel(null); }}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">✕</button>
      </div>
      <div className="flex-1 min-h-0 p-2 overflow-hidden">
        <FileBrowser onPlayVideo={handlePlayVideo} compact />
      </div>
    </div>
  );

  const membersPanel = (
    <RoomList />
  );

  const chatPanel = (
    <ChatBox sendMessage={sendMessage} />
  );

  return (
    <div className="h-[100dvh] flex flex-col bg-gray-100 dark:bg-gray-950 overflow-hidden">
      {/* ── header ── */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-2 md:px-4 py-1.5 md:py-2 flex items-center gap-1.5 md:gap-3 flex-shrink-0">
        <h1 className="text-base md:text-lg font-bold text-primary-500 hidden sm:block">🎬 ZlPlay</h1>
        <h1 className="text-sm font-bold text-primary-500 sm:hidden">🎬</h1>

        <button onClick={copyCode} className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs md:text-sm font-mono font-bold tracking-wider hover:bg-primary-50 dark:hover:bg-primary-900/20 text-gray-800 dark:text-gray-200">
          {roomCode}
          <span className="text-[10px] opacity-50">📋</span>
        </button>

        <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className={`text-[10px] md:text-xs hidden sm:inline ${wsConnected ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
          {wsConnected ? '在线' : '离线'}
        </span>
        <SyncIndicator status={syncStatus} deviation={deviation} />

        {isOwner && (
          <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] md:text-xs rounded-full font-medium">👑</span>
        )}

        <button onClick={cycleTheme} className="text-xs md:text-sm px-1" title="切换主题">{themeIcon}</button>

        <span className="text-[10px] md:text-xs text-gray-400 hidden sm:inline">{members.length}人</span>

        <div className="flex-1" />

        {/* desktop panel toggles */}
        <div className="hidden lg:flex gap-1">
          <button onClick={() => setShowFileBrowser(!showFileBrowser)}
            className={`px-2 py-1 text-xs rounded transition-colors ${showFileBrowser ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
            📁 <span className="hidden xl:inline">视频库</span>
          </button>
          <button onClick={() => setShowMembers(!showMembers)}
            className={`px-2 py-1 text-xs rounded transition-colors ${showMembers ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
            👥 <span className="hidden xl:inline">成员</span>
          </button>
          <button onClick={() => setShowChat(!showChat)}
            className={`px-2 py-1 text-xs rounded transition-colors ${showChat ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
            💬 <span className="hidden xl:inline">聊天</span>
          </button>
        </div>

        {/* leave / destroy */}
        <div className="flex gap-1.5 ml-1 md:ml-3">
          {isOwner && (
            <button onClick={handleDestroy} className="px-2 md:px-3 py-1 bg-red-500 text-white text-[10px] md:text-xs rounded-md hover:bg-red-600 transition-colors">
              解散
            </button>
          )}
          <button onClick={handleLeave} className="px-2 md:px-3 py-1 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 text-[10px] md:text-xs rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            离开
          </button>
        </div>
      </header>

      {/* ── error bar ── */}
      {wsError && (
        <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-2 md:px-4 py-1.5 text-red-600 dark:text-red-400 text-xs flex-shrink-0">
          ⚠️ {wsError}
        </div>
      )}

      {/* ── main content ── */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* player */}
        <div className="flex-1 flex flex-col min-w-0 md:p-4 p-1">
          {currentVideo?.title && (
            <div className="mb-1 md:mb-2 text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 truncate px-1">
              🎬 {currentVideo.title}
            </div>
          )}
          <div className="flex-1 flex items-center justify-center">
            <VideoPlayer
              src={videoSrc}
              onPlay={handlePlayerPlay}
              onPause={handlePlayerPause}
              onSeeked={handlePlayerSeeked}
              onReady={registerPlayer}
            />
          </div>
        </div>

        {/* desktop side panel */}
        <div className={`hidden lg:flex flex-shrink-0 transition-all duration-300 ${(showMembers || showChat || showFileBrowser) ? 'w-72' : 'w-0'}`}>
          <div className="h-full flex flex-col p-2 pl-0 gap-2 w-72">
            {showFileBrowser && <div className="flex-1 min-h-0">{fileBrowserPanel}</div>}
            {showMembers && <div className="flex-1 min-h-0">{membersPanel}</div>}
            {showChat && <div className="flex-1 min-h-0">{chatPanel}</div>}
          </div>
        </div>
      </div>

      {/* ── keyboard shortcuts (desktop only) ── */}
      <div className="hidden md:flex bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 px-4 py-1.5 items-center gap-4 text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
        <span><kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">Space</kbd> 播放/暂停</span>
        <span><kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">←→</kbd> ±5s</span>
        <span><kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">F</kbd> 全屏</span>
        <span><kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">M</kbd> 静音</span>
      </div>

      {/* ── mobile bottom nav ── */}
      <nav className="lg:hidden flex bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex-shrink-0">
        {([
          ['📁', '视频库', 'videos'],
          ['👥', `成员(${members.length})`, 'members'],
          ['💬', '聊天', 'chat'],
        ] as const).map(([icon, label, key]) => (
          <button key={key} onClick={() => setMobilePanel(mobilePanel === key ? null : key)}
            className={`flex-1 flex flex-col items-center py-2 text-xs transition-colors ${mobilePanel === key ? 'text-primary-500' : 'text-gray-500 dark:text-gray-400'}`}>
            <span className="text-lg">{icon}</span>
            <span className="text-[10px]">{label}</span>
          </button>
        ))}
        <button onClick={handleLeave}
          className="flex-1 flex flex-col items-center py-2 text-xs text-red-400">
          <span className="text-lg">🚪</span>
          <span className="text-[10px]">离开</span>
        </button>
      </nav>

      {/* ── mobile panel overlay ── */}
      {mobilePanel && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col" onClick={() => setMobilePanel(null)}>
          <div className="h-12 flex-shrink-0" /> {/* gap for tapping out */}
          <div className="flex-1 bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {mobilePanel === 'videos' ? '📁 视频库' : mobilePanel === 'members' ? '👥 成员' : '💬 聊天'}
              </h3>
              <button onClick={() => setMobilePanel(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">✕</button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {mobilePanel === 'videos' && fileBrowserPanel}
              {mobilePanel === 'members' && membersPanel}
              {mobilePanel === 'chat' && chatPanel}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
