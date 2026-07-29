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
  IconChevronDown,
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
  const wsRtt = useRoomStore((s) => s.wsRtt);
  const setStoreRoomPassword = useRoomStore((s) => s.setRoomPassword);

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
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [resumePos, setResumePos] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (currentVideo?.url) setVideoSrc(currentVideo.url);
  }, [currentVideo]);

  const prevRoomRef = useRef('');
  useEffect(() => {
    if (roomCode && prevRoomRef.current !== roomCode) {
      // 仅当切换房间且有视频时才广播（新进房由 sync_response 设置，不重复广播）
      if (prevRoomRef.current && currentVideo) {
        sendMessage('change_video', { url: currentVideo.url, title: currentVideo.title });
      }
    }
    prevRoomRef.current = roomCode;
  }, [roomCode, currentVideo, sendMessage]);

  const handleLeave = useCallback(() => { sendMessage('leave_room', {}); resetRoom(); }, [sendMessage, resetRoom]);
  const handleDestroy = useCallback(() => {
    if (!confirm('确定解散房间？')) return;
    sendMessage('destroy_room', {});
    resetRoom();
  }, [sendMessage, resetRoom]);

  const handlePlayVideo = useCallback((url: string, title: string, subUrl?: string | null, startPos?: number) => {
    setCurrentVideo({ url, title });
    setPlayerState({ playing: false, position: 0, timestamp: Date.now() });
    sendMessage('change_video', { url, title });
    setStoreRoomPassword(useRoomStore.getState().roomPassword);
    setSubtitleUrl(subUrl || null);
    setResumePos(startPos);
    setMobilePanel(null);
  }, [sendMessage, setCurrentVideo, setPlayerState, setStoreRoomPassword]);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(roomCode).catch(() => {
      const el = document.createElement('input');
      el.value = roomCode; document.body.appendChild(el);
      el.select(); document.execCommand('copy'); document.body.removeChild(el);
    });
  }, [roomCode]);

  const toggleDesktopPanel = (p: DesktopPanel) => {
    setDesktopPanels((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
    setCollapsedPanels((prev) => {
      const next = new Set(prev);
      next.delete(p);
      return next;
    });
  };

  const toggleCollapse = (p: DesktopPanel) => {
    setCollapsedPanels((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  if (currentPage !== 'room') return null;

  const sidebarOpen = desktopPanels.size > 0;

  // 桌面 header tab 按钮（选中态下划线 primary-500）
  const desktopHeaderBtn = (p: DesktopPanel, label: string, icon: React.ReactNode) => {
    const active = desktopPanels.has(p);
    return (
      <button onClick={() => toggleDesktopPanel(p)}
        className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors
          ${active
            ? 'bg-[var(--primary-500)]/10 text-[var(--primary-500)]'
            : 'text-secondary hover:text-primary hover:bg-elevated'}`}>
        {icon}
        <span className="hidden xl:inline">{label}</span>
        {active && (
          <span className="absolute -bottom-[1px] left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--primary-500)]" />
        )}
      </button>
    );
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-base overflow-hidden overflow-x-hidden">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center gap-2 px-3 h-12 bg-card border-b border-base">
        {/* 左：房间码 + 复制 + 邀请 */}
        <button onClick={copyCode}
          className="flex items-center gap-1.5 px-2 py-1 bg-elevated hover:bg-[var(--primary-500)]/10 rounded-lg text-xs font-mono font-bold tracking-wider text-primary transition-colors flex-shrink-0">
          {roomCode}
          <IconCopy size={11} className="opacity-40 hidden sm:inline" />
        </button>

        <button onClick={() => {
          const base = `${window.location.origin}${window.location.pathname}`;
          const pwd = useRoomStore.getState().roomPassword;
          const link = `${base}?room=${roomCode}${pwd ? '&pwd=' + encodeURIComponent(pwd) : ''}`;
          navigator.clipboard.writeText(link).catch(() => {
            const el = document.createElement('input');
            el.value = link; document.body.appendChild(el);
            el.select(); document.execCommand('copy'); document.body.removeChild(el);
          });
        }}
          className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-[10px] text-secondary hover:text-primary hover:bg-elevated rounded-lg transition-colors flex-shrink-0"
          title="复制邀请链接">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          <span>邀请</span>
        </button>

        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${wsConnected ? 'bg-[#22C55E]' : 'bg-[#EF4444]'}`} />

        <SyncIndicator status={syncStatus} deviation={deviation} rtt={wsRtt}
          onReconnect={() => {
            if (wsConnected) sendMessage('request_sync', {});
          }} />


        {isOwner && (
          <span className="flex-shrink-0 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-[#F59E0B] bg-[#F59E0B]/10 rounded-full">
            <IconCrown size={10} />
          </span>
        )}

        <span className="text-[10px] text-secondary hidden sm:inline flex-shrink-0">{members.length} 人</span>

        {/* 中：留白 */}
        <div className="flex-1" />

        {/* 右：tab + 深色 + 退出 */}
        <div className="hidden lg:flex items-center gap-1.5">
          {desktopHeaderBtn('videos', '视频库', <IconFolder size={15} />)}
          {desktopHeaderBtn('members', '成员', <IconUsers size={15} />)}
          {desktopHeaderBtn('chat', '聊天', <IconChat size={15} />)}
        </div>

        <span className="w-px h-5 bg-[var(--border-color)] hidden lg:block mx-0.5" />

        <button onClick={cycleTheme} className="p-1.5 text-secondary hover:text-primary rounded-lg hover:bg-elevated transition-colors">
          {isDark ? <IconSun size={15} /> : <IconMoon size={15} />}
        </button>

        <div className="flex items-center gap-1">
          {isOwner && (
            <button onClick={handleDestroy}
              className="px-2.5 py-1 text-[11px] font-medium text-[#EF4444] hover:bg-[#EF4444]/10 rounded-lg transition-colors">
              解散
            </button>
          )}
          <button onClick={handleLeave}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-secondary hover:text-primary hover:bg-elevated rounded-lg transition-colors">
            <IconLogOut size={13} /> <span className="hidden sm:inline">离开</span>
          </button>
        </div>
      </header>

      {/* Error bar */}
      {wsError && (
        <div className="flex-shrink-0 bg-[#EF4444]/10 border-b border-[#EF4444]/30 px-3 py-1.5 text-[#EF4444] text-xs">
          {wsError}
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex lg:flex-row min-h-0">
        {/* 播放器区 */}
        <div className="flex-1 flex flex-col min-w-0 p-2 md:p-3 min-h-0 overflow-hidden">
          {currentVideo?.title && (
            <div className="w-full min-w-0 max-w-full mb-1.5 text-xs md:text-sm font-medium text-primary truncate px-1 flex-shrink-0">
              <IconVideo size={13} className="inline mr-1.5 text-[var(--primary-500)]" />
              {currentVideo.title}
            </div>
          )}
          <div className="flex-1 flex min-h-0 w-full">
            <VideoPlayer
              src={videoSrc}
              subtitleUrl={subtitleUrl}
              resumePosition={resumePos}
              onPlay={handlePlayerPlay}
              onPause={handlePlayerPause}
              onSeeked={handlePlayerSeeked}
              onReady={registerPlayer}
              onRetry={retryGetPlayUrl}
            />
          </div>
        </div>

        {/* 桌面侧边栏 */}
        <div className={`hidden lg:block flex-shrink-0 transition-all duration-300 ease-in-out overflow-hidden
          ${sidebarOpen ? 'w-80 border-l border-base' : 'w-0'}`}>
          <div className="w-80 h-full flex flex-col bg-card">
            {(['videos', 'members', 'chat'] as DesktopPanel[]).map((p) => {
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
              <div className="flex-1 flex items-center justify-center text-secondary text-xs p-4 text-center">
                点击上方按钮打开面板
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 键盘快捷键提示栏（底部导航上方） */}
      <div className="hidden lg:flex flex-shrink-0 items-center gap-4 px-4 py-1.5 bg-card/50 backdrop-blur border-t border-base text-[11px] text-secondary">
        <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 bg-elevated rounded text-[10px]">Space</kbd> 播放/暂停</span>
        <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 bg-elevated rounded text-[10px]">←→</kbd> ±5s</span>
        <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 bg-elevated rounded text-[10px]">F</kbd> 全屏</span>
        <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 bg-elevated rounded text-[10px]">M</kbd> 静音</span>
        <div className="flex-1" />
        <span className="text-[10px] opacity-60 font-display">ZlPlay</span>
      </div>

      {/* 移动端底部导航 */}
      <nav className="lg:hidden flex-shrink-0 flex bg-elevated border-t border-base pb-safe">
        {([
          [<IconFolder size={20} key="f" />, '视频库', 'videos'],
          [<IconUsers size={20} key="u" />, `成员(${members.length})`, 'members'],
          [<IconChat size={20} key="c" />, '聊天', 'chat'],
        ] as const).map(([icon, label, key]) => (
          <button key={key} onClick={() => setMobilePanel(mobilePanel === key ? null : key)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] min-h-[48px] transition-colors
              ${mobilePanel === key ? 'text-[var(--primary-500)]' : 'text-secondary'}`}>
            {icon}{label}
          </button>
        ))}
        <button onClick={handleLeave}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] text-[#EF4444] min-h-[48px]">
          <IconLogOut size={20} />离开
        </button>
      </nav>

      {/* 移动端面板 */}
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
  handlePlayVideo: (url: string, title: string, subUrl?: string | null, startPos?: number) => void;
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
    <div className={`flex flex-col min-h-0 bg-card border-b border-base last:border-b-0 mb-2 mx-2 rounded-[12px] shadow-card overflow-hidden first:mt-2 ${collapsed ? 'flex-shrink-0' : 'flex-1'}`}>
      <div
        className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-elevated/50 select-none flex-shrink-0"
        onClick={onToggleCollapse}>
        <h3 className="font-display text-xs font-semibold text-secondary inline-flex items-center gap-1.5">
          {icon} {title}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-1 hover:bg-elevated rounded-md text-secondary hover:text-primary transition-colors"
            title="关闭面板">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
          <span className="text-secondary transition-transform duration-200" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
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
          {panel === 'members' && <RoomList sendMessage={sendMessage} />}
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
      await fetch(`${formatted}/api/me`).catch(() => null);
      setAlistUrl(formatted.startsWith('http') ? formatted : `https://${formatted}`);
    } catch { /* ignore */ }
    setLoading(false);
  };
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-3">
      <IconFolder size={24} className="text-secondary opacity-40 mb-2" />
      <p className="text-xs text-secondary mb-3">未设置 Alist 服务器</p>
      <div className="flex gap-1 w-full max-w-[200px]">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
          placeholder="alist.example.com"
          className="flex-1 px-2.5 py-1.5 text-xs bg-card border border-base rounded-lg text-primary placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--primary-500)] transition-colors" />
        <button onClick={handleConnect} disabled={loading}
          className="px-3 py-1.5 text-xs bg-[var(--primary-500)] text-white rounded-lg hover:bg-[var(--primary-600)] disabled:opacity-50 transition-colors">
          {loading ? '...' : '连接'}
        </button>
      </div>
    </div>
  );
}
