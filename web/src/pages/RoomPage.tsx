import { useState, useEffect, useCallback, useRef } from 'react';
import { useRoomStore } from '../store/roomStore';
import { useSync } from '../hooks/useSync';
import type { PlayerAPI } from '../hooks/useSync';
import { useTheme } from '../hooks/useTheme';
import VideoPlayer from '../components/VideoPlayer';
import ChatBox from '../components/ChatBox';
import RoomList from '../components/RoomList';
import FileBrowser from '../components/FileBrowser';
import MobilePanel from '../components/MobilePanel';
import SyncIndicator from '../components/SyncIndicator';
import { retryGetPlayUrl } from '../utils/alistApi';
import {
  IconVideo, IconFolder, IconUsers, IconChat,
  IconCopy, IconCrown, IconSun, IconMoon, IconLogOut,
  IconChevronDown, IconChevronUp,
} from '../components/Icons';

interface RoomPageProps {
  sendMessage: (type: string, payload: Record<string, unknown>) => void;
  syncHandlerRef: React.MutableRefObject<((cmd: any) => void) | undefined>;
}

type MobilePanelType = 'members' | 'chat' | 'videos' | null;
type DesktopPanel = 'videos' | 'members' | 'chat';

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
  const alistUrl = useRoomStore((s) => s.alistUrl);

  const { cycle: cycleTheme, isDark } = useTheme();

  const {
    status: syncStatus, deviation,
    registerPlayer, handleRemoteCommand,
    onRoomEnter, onRoomLeave,
    handlePlayerPlay, handlePlayerPause, handlePlayerSeeked,
  } = useSync({ sendMessage, myId, connected: wsConnected });

  useEffect(() => {
    syncHandlerRef.current = handleRemoteCommand;
    return () => { syncHandlerRef.current = undefined; };
  }, [syncHandlerRef, handleRemoteCommand]);

  useEffect(() => { onRoomEnter(); return () => onRoomLeave(); }, [onRoomEnter, onRoomLeave]);

  const [desktopPanels, setDesktopPanels] = useState<Set<DesktopPanel>>(new Set(['members']));
  const [collapsedPanels, setCollapsedPanels] = useState<Set<DesktopPanel>>(new Set());
  const [mobilePanel, setMobilePanel] = useState<MobilePanelType>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);

  useEffect(() => {
    if (currentVideo?.url) setVideoSrc(currentVideo.url);
  }, [currentVideo]);

  const prevRoomRef = useRef('');
  useEffect(() => {
    if (roomCode && prevRoomRef.current !== roomCode && currentVideo) {
      sendMessage('change_video', { url: currentVideo.url, title: currentVideo.title });
    }
    prevRoomRef.current = roomCode;
  }, [roomCode, currentVideo, sendMessage]);

  const handleLeave = useCallback(() => { sendMessage('leave_room', {}); resetRoom(); }, [sendMessage, resetRoom]);
  const handleDestroy = useCallback(() => {
    if (!confirm('确定解散房间？')) return;
    sendMessage('destroy_room', {});
    resetRoom();
  }, [sendMessage, resetRoom]);

  const handlePlayVideo = useCallback((url: string, title: string) => {
    setCurrentVideo({ url, title });
    setPlayerState({ playing: false, position: 0, timestamp: Date.now() });
    sendMessage('change_video', { url, title });
    setMobilePanel(null);
  }, [sendMessage, setCurrentVideo, setPlayerState]);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(roomCode).catch(() => {
      const el = document.createElement('input');
      el.value = roomCode; document.body.appendChild(el);
      el.select(); document.execCommand('copy'); document.body.removeChild(el);
    });
  }, [roomCode]);

  const toggleDesktopPanel = (p: DesktopPanel) => {
    setDesktopPanels(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
    setCollapsedPanels(prev => {
      const next = new Set(prev);
      next.delete(p);
      return next;
    });
  };

  const toggleCollapse = (p: DesktopPanel) => {
    setCollapsedPanels(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  if (currentPage !== 'room') return null;

  const sidebarOpen = desktopPanels.size > 0;

  const desktopHeaderBtn = (p: DesktopPanel, label: string, icon: React.ReactNode) => {
    const active = desktopPanels.has(p);
    return (
      <button onClick={() => toggleDesktopPanel(p)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors
          ${active
            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
            : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
        {icon}
        <span className="hidden xl:inline">{label}</span>
      </button>
    );
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-gray-50 dark:bg-gray-950 overflow-hidden overflow-x-hidden">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center gap-1.5 px-2 h-11 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />

        <button onClick={copyCode}
          className="flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-[11px] font-mono font-bold tracking-wider text-gray-700 dark:text-gray-300 transition-colors flex-shrink-0">
          {roomCode}
          <IconCopy size={10} className="opacity-40 hidden sm:inline" />
        </button>

        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        <SyncIndicator status={syncStatus} deviation={deviation} />

        {isOwner && (
          <span className="flex-shrink-0 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-full">
            <IconCrown size={10} />
          </span>
        )}

        <span className="text-[10px] text-gray-400 hidden sm:inline flex-shrink-0">{members.length} 人</span>

        <button onClick={cycleTheme} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors">
          {isDark ? <IconSun size={15} /> : <IconMoon size={15} />}
        </button>

        <div className="flex-1" />

        <div className="hidden lg:flex items-center gap-1">
          {desktopHeaderBtn('videos', '视频库', <IconFolder size={15} />)}
          {desktopHeaderBtn('members', '成员', <IconUsers size={15} />)}
          {desktopHeaderBtn('chat', '聊天', <IconChat size={15} />)}
        </div>

        <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 hidden lg:block mx-0.5" />

        <div className="flex items-center gap-1">
          {isOwner && (
            <button onClick={handleDestroy}
              className="px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">
              解散
            </button>
          )}
          <button onClick={handleLeave}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors">
            <IconLogOut size={13} /> 离开
          </button>
        </div>
      </header>

      {/* Error bar */}
      {wsError && (
        <div className="flex-shrink-0 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-3 py-1.5 text-red-600 dark:text-red-400 text-xs">
          {wsError}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex lg:flex-row min-h-0">
        {/* Video player area */}
        <div className="flex-1 flex flex-col min-w-0 p-2 md:p-3 min-h-0 overflow-hidden">
          {currentVideo?.title && (
            <div className="w-full min-w-0 max-w-full mb-1.5 text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 truncate px-1 flex-shrink-0">
              <IconVideo size={13} className="inline mr-1 text-blue-500" />
              {currentVideo.title}
            </div>
          )}
          <div className="flex-1 flex min-h-0 w-full">
            <VideoPlayer
              src={videoSrc}
              onPlay={handlePlayerPlay}
              onPause={handlePlayerPause}
              onSeeked={handlePlayerSeeked}
              onReady={registerPlayer}
              onRetry={retryGetPlayUrl}
            />
          </div>
        </div>

        {/* Desktop sidebar */}
        <div className={`hidden lg:block flex-shrink-0 transition-all duration-300 ease-in-out overflow-hidden
          ${sidebarOpen ? 'w-80 border-l border-gray-200 dark:border-gray-800' : 'w-0'}`}>
          <div className="w-80 h-full flex flex-col bg-white dark:bg-gray-900">
            {(['videos', 'members', 'chat'] as DesktopPanel[]).map(p => {
              if (!desktopPanels.has(p)) return null;
              const collapsed = collapsedPanels.has(p);
              return (
                <DesktopPanelBlock
                  key={p}
                  panel={p}
                  collapsed={collapsed}
                  onToggleCollapse={() => toggleCollapse(p)}
                  onClose={() => toggleDesktopPanel(p)}
                  handlePlayVideo={handlePlayVideo}
                  sendMessage={sendMessage}
                  members={members}
                  alistUrl={alistUrl}
                />
              );
            })}
            {desktopPanels.size === 0 && (
              <div className="flex-1 flex items-center justify-center text-gray-300 dark:text-gray-600 text-xs p-4 text-center">
                点击上方按钮打开面板
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div className="hidden lg:flex flex-shrink-0 items-center gap-3 px-4 py-1 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-400">
        <span><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">Space</kbd> 播放/暂停</span>
        <span><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">←→</kbd> ±5s</span>
        <span><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">F</kbd> 全屏</span>
        <span><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">M</kbd> 静音</span>
        <div className="flex-1" />
        <span className="text-[10px] text-gray-300 dark:text-gray-700">ZlPlay</span>
      </div>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden flex-shrink-0 flex bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 pb-safe">
        {([
          [<IconFolder size={18} key="f" />, '视频库', 'videos'],
          [<IconUsers size={18} key="u" />, `成员(${members.length})`, 'members'],
          [<IconChat size={18} key="c" />, '聊天', 'chat'],
        ] as const).map(([icon, label, key]) => (
          <button key={key} onClick={() => setMobilePanel(mobilePanel === key ? null : key)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] min-h-[44px] transition-colors
              ${mobilePanel === key ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`}>
            {icon}{label}
          </button>
        ))}
        <button onClick={handleLeave}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] text-red-400 min-h-[44px]">
          <IconLogOut size={18} />离开
        </button>
      </nav>

      {/* Mobile panel */}
      {mobilePanel && (
        <MobilePanel
          title={mobilePanel === 'videos' ? '视频库' : mobilePanel === 'members' ? '成员' : '聊天'}
          onClose={() => setMobilePanel(null)}>
          {mobilePanel === 'videos' && (alistUrl
            ? <FileBrowser onPlayVideo={handlePlayVideo} compact />
            : <AlistSetupHint />
          )}
          {mobilePanel === 'members' && <RoomList />}
          {mobilePanel === 'chat' && <ChatBox sendMessage={sendMessage} />}
        </MobilePanel>
      )}
    </div>
  );
}

function DesktopPanelBlock({ panel, collapsed, onToggleCollapse, onClose, handlePlayVideo, sendMessage, members, alistUrl }: {
  panel: DesktopPanel;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onClose: () => void;
  handlePlayVideo: (url: string, title: string) => void;
  sendMessage: (type: string, payload: Record<string, unknown>) => void;
  members: unknown[];
  alistUrl: string;
}) {
  const config: Record<DesktopPanel, { title: string; icon: React.ReactNode }> = {
    videos: { title: '视频库', icon: <IconFolder size={14} /> },
    members: { title: `成员 (${(members as any[]).length})`, icon: <IconUsers size={14} /> },
    chat: { title: '聊天', icon: <IconChat size={14} /> },
  };
  const { title, icon } = config[panel];

  return (
    <div className={`flex flex-col min-h-0 border-b border-gray-100 dark:border-gray-800 last:border-b-0 ${collapsed ? 'flex-shrink-0' : 'flex-1'}`}>
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 select-none flex-shrink-0"
        onClick={onToggleCollapse}>
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5">
          {icon} {title}
        </h3>
        <div className="flex items-center gap-0.5">
          <button onClick={e => { e.stopPropagation(); onClose(); }}
            className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-400 hover:text-gray-600 transition-colors"
            title="关闭面板">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
          <span className="text-gray-400 transition-transform duration-200" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            <IconChevronDown size={14} />
          </span>
        </div>
      </div>
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-hidden px-2 pb-2">
          {panel === 'videos' && (alistUrl
            ? <FileBrowser onPlayVideo={handlePlayVideo} compact />
            : <AlistSetupHint />
          )}
          {panel === 'members' && <RoomList />}
          {panel === 'chat' && <ChatBox sendMessage={sendMessage} />}
        </div>
      )}
    </div>
  );
}

function AlistSetupHint() {
  const setAlistUrl = useRoomStore((s) => s.setAlistUrl);
  const [input, setInput] = useState((import.meta.env.VITE_DEFAULT_ALIST_URL as string) || '');
  const [loading, setLoading] = useState(false);
  const handleConnect = async () => {
    const formatted = input.trim().replace(/\/+$/, '');
    if (!formatted) return;
    setLoading(true);
    try {
      const res = await fetch(`${formatted}/api/me`).catch(() => null);
      setAlistUrl(formatted.startsWith('http') ? formatted : `https://${formatted}`);
    } catch { /* ignore */ }
    setLoading(false);
  };
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-3">
      <IconFolder size={24} className="text-gray-300 dark:text-gray-600 mb-2" />
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">未设置 Alist 服务器</p>
      <div className="flex gap-1 w-full max-w-[200px]">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleConnect()}
          placeholder="alist.example.com"
          className="flex-1 px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <button onClick={handleConnect} disabled={loading}
          className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 transition-colors">
          {loading ? '...' : '连接'}
        </button>
      </div>
    </div>
  );
}
