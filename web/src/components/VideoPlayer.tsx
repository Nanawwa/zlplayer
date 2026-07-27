import { useRef, useEffect } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { useRoomStore } from '../store/roomStore';
import { getAlistToken } from '../utils/alistApi';
import type { PlayerAPI } from '../hooks/useSync';

interface VideoPlayerProps {
  src: string | null;
  onPlay?: () => void;
  onPause?: () => void;
  onSeeked?: () => void;
  onReady?: (api: PlayerAPI) => void;
}

export default function VideoPlayer({
  src,
  onPlay,
  onPause,
  onSeeked,
  onReady,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<Artplayer | null>(null);

  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onSeekedRef = useRef(onSeeked);

  onPlayRef.current = onPlay;
  onPauseRef.current = onPause;
  onSeekedRef.current = onSeeked;

  // ── 初始化 / 切换视频 ──
  useEffect(() => {
    if (!containerRef.current || !src) return;

    // 销毁旧实例
    if (artRef.current) {
      artRef.current.destroy();
      artRef.current = null;
    }

    const alistToken = getAlistToken();
    const isHls = src.endsWith('.m3u8');
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    console.log('[ArtPlayer] src:', src, 'hls:', isHls, 'safari:', isSafari);

    // iOS Safari 用原生 video 标签处理 HLS，不用 ArtPlayer 的 customType
    // 避免 HLS.js 与 Safari 原生 HLS 冲突
    const art = new Artplayer({
      container: containerRef.current,
      url: src,
      type: (isHls && isSafari) ? 'auto' : (isHls ? 'm3u8' : 'auto'),
      autoplay: false,
      autoSize: true,
      autoMini: true,
      loop: false,
      flip: true,
      playbackRate: true,
      aspectRatio: true,
      setting: true,
      hotkey: true,
      pip: true,
      mutex: true,
      fullscreen: true,
      fullscreenWeb: true,
      miniProgressBar: true,
      theme: '#0A84FF',
      lang: 'zh-cn',
      moreVideoAttr: {
        playsInline: true,
      },
      customType: (isHls && !isSafari) ? {
        m3u8: function (video: HTMLVideoElement, url: string) {
          if (Hls.isSupported()) {
            video.crossOrigin = 'anonymous';
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false,
              xhrSetup: (xhr) => {
                if (alistToken) {
                  xhr.setRequestHeader('Authorization', alistToken);
                }
              },
            });
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal) {
                console.error('[ArtPlayer] HLS 致命错误:', data.type, data.details);
              }
            });
            hls.loadSource(url);
            hls.attachMedia(video);
          } else {
            video.src = url;
          }
        },
      } as any : undefined,
    });

    artRef.current = art;

    // ── 暴露 PlayerAPI 给 useSync ──
    const playerApi: PlayerAPI = {
      play: () => art.play(),
      pause: () => art.pause(),
      seek: (t: number) => { art.seek = t; },
      getCurrentTime: () => art.currentTime,
      isPaused: () => art.video.paused,
      setPlaybackRate: (r: number) => { art.playbackRate = r; },
      getPlaybackRate: () => art.playbackRate,
      getDuration: () => art.duration,
      isBuffering: () => art.video.readyState < 3,
    };
    onReady?.(playerApi);

    // ── 播放器事件 → 通知 useSync（useSync 负责判断是否广播） ──
    art.on('video:playing', () => onPlayRef.current?.());
    art.on('video:pause', () => onPauseRef.current?.());
    art.on('video:seeked', () => onSeekedRef.current?.());

    // 错误日志 + 用户可见提示
    art.on('error', (err: any) => {
      console.error('[ArtPlayer] 播放错误:', err);
      art.template.$container.innerHTML = `
        <div style="color:#ef4444;text-align:center;padding:20px;">
          <p>视频加载失败</p>
          <p style="font-size:11px;color:#6b7280;margin-top:8px;word-break:break-all;">${art.option.url}</p>
        </div>`;
    });

    return () => {
      console.log('[ArtPlayer] 销毁');
      if (artRef.current) {
        artRef.current.destroy();
        artRef.current = null;
      }
    };
  }, [src]); // 仅 src 变化时重建

  // ── 无视频时占位 ──
  if (!src) {
    return (
      <div className="w-full aspect-video bg-black rounded-lg flex items-center justify-center text-gray-400">
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <p className="text-sm">请选择视频开始播放</p>
          <p className="text-xs mt-1 opacity-60">在视频列表中点击视频即可播放</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full aspect-video rounded-lg overflow-hidden bg-black"
    />
  );
}
