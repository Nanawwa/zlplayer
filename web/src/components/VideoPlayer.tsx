import { useRef, useEffect, useCallback } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { getAlistToken } from '../utils/alistApi';
import type { PlayerAPI } from '../hooks/useSync';

interface VideoPlayerProps {
  src: string | null;
  onPlay?: () => void;
  onPause?: () => void;
  onSeeked?: () => void;
  onReady?: (api: PlayerAPI) => void;
  onRetry?: () => Promise<string>;
}

const MAX_RETRY = 3;

export default function VideoPlayer({ src, onPlay, onPause, onSeeked, onReady, onRetry }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<Artplayer | null>(null);
  const retryCountRef = useRef(0);
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onSeekedRef = useRef(onSeeked);
  onPlayRef.current = onPlay;
  onPauseRef.current = onPause;
  onSeekedRef.current = onSeeked;

  const doRetry = useCallback((art: Artplayer, currentSrc: string) => {
    if (retryCountRef.current >= MAX_RETRY) return false;
    retryCountRef.current++;
    const delay = retryCountRef.current * 1000;
    setTimeout(() => {
      if (art.video) {
        const url = currentSrc.includes('?')
          ? `${currentSrc}&_rt=${Date.now()}`
          : `${currentSrc}?_rt=${Date.now()}`;
        art.video.src = url;
        art.play();
      }
    }, delay);
    return true;
  }, []);

  useEffect(() => {
    if (!containerRef.current || !src) return;

    retryCountRef.current = 0;
    if (artRef.current) { artRef.current.destroy(); artRef.current = null; }

    const alistToken = getAlistToken();
    const isHls = src.endsWith('.m3u8');

    function hlsHandler(video: HTMLVideoElement, url: string) {
      if (!Hls.isSupported()) { video.src = url; return; }
      video.crossOrigin = 'anonymous';
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        xhrSetup: (xhr) => { if (alistToken) xhr.setRequestHeader('Authorization', alistToken); },
      });
      hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) console.error('[Player] HLS fatal:', d.type, d.details); });
      hls.loadSource(url);
      hls.attachMedia(video);
    }

    const art = new Artplayer({
      container: containerRef.current,
      url: src,
      type: isHls ? 'm3u8' : 'auto',
      autoplay: false,
      autoSize: false,
      autoMini: false,
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
      theme: '#3B82F6',
      lang: 'zh-cn',
      moreVideoAttr: {
        playsInline: true,
        'referrerpolicy': 'no-referrer',
      },
      ...(isHls ? { customType: { m3u8: hlsHandler } } : {}),
    } as any);

    if (art.video) {
      art.video.setAttribute('referrerpolicy', 'no-referrer');
    }
    artRef.current = art;

    const api: PlayerAPI = {
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
    onReady?.(api);

    art.on('video:playing', () => onPlayRef.current?.());
    art.on('video:pause', () => onPauseRef.current?.());
    art.on('video:seeked', () => onSeekedRef.current?.());

    art.on('error', () => {
      const ve = art.video?.error;
      const names = ['', 'MEDIA_ERR_ABORTED', 'MEDIA_ERR_NETWORK', 'MEDIA_ERR_DECODE', 'MEDIA_ERR_SRC_NOT_SUPPORTED'];
      const codeName = ve?.code ? names[ve.code] || 'UNKNOWN' : 'UNKNOWN';

      if (doRetry(art, src)) return;

      art.template.$container.innerHTML = `
        <div style="color:#ef4444;text-align:center;padding:20px;background:#0a0a0a;border-radius:8px;">
          <p style="font-size:14px;font-weight:500;">视频加载失败</p>
          <p style="font-size:11px;color:#f87171;margin-top:4px;">${codeName}${ve?.message ? ': ' + ve.message : ''}</p>
          <p style="font-size:10px;color:#6b7280;margin-top:2px;">已重试 ${MAX_RETRY} 次</p>
          <p style="font-size:9px;color:#4b5563;margin-top:8px;word-break:break-all;max-width:500px;margin-left:auto;margin-right:auto;">${src}</p>
          ${onRetryRef.current ? `
            <button id="zlplay-retry-btn" style="margin-top:10px;padding:6px 20px;background:#3B82F6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;">
              重新获取链接
            </button>
          ` : '<p style="font-size:10px;color:#6b7280;margin-top:8px;">请返回视频列表重新选择</p>'}
        </div>`;

      const btn = document.getElementById('zlplay-retry-btn');
      if (btn && onRetryRef.current) {
        btn.onclick = async () => {
          btn.textContent = '获取中...';
          (btn as HTMLButtonElement).disabled = true;
          try {
            retryCountRef.current = 0;
            const newUrl = await onRetryRef.current!();
            art.destroy();
            const newArt = new Artplayer({
              container: containerRef.current!,
              url: newUrl,
              type: newUrl.endsWith('.m3u8') ? 'm3u8' : 'auto',
              autoplay: true,
              autoSize: false,
              theme: '#3B82F6',
              lang: 'zh-cn',
              moreVideoAttr: { playsInline: true, 'referrerpolicy': 'no-referrer' },
              ...(newUrl.endsWith('.m3u8') ? { customType: { m3u8: hlsHandler } } : {}),
            } as any);
            if (newArt.video) newArt.video.setAttribute('referrerpolicy', 'no-referrer');
            artRef.current = newArt;
          } catch (err) {
            console.error('[Player] retry failed:', err);
            btn.textContent = '重试失败';
            (btn as HTMLButtonElement).disabled = false;
          }
        };
      }
    });

    return () => {
      if (artRef.current) { artRef.current.destroy(); artRef.current = null; }
    };
  }, [src, doRetry]);

  if (!src) {
    return (
      <div className="w-full max-w-4xl mx-auto aspect-video max-h-full bg-black rounded-lg flex items-center justify-center" style={{ isolation: 'isolate' as any, position: 'relative', zIndex: 0 }}>
        <div className="text-center text-gray-500">
          <svg className="w-12 h-12 mx-auto mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <p className="text-sm">选择视频开始播放</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full max-w-5xl mx-auto aspect-video max-h-full rounded-lg overflow-hidden bg-black" style={{ isolation: 'isolate' as any, position: 'relative', zIndex: 0 }} />
  );
}
