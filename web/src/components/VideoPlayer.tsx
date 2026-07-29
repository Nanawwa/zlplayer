import { useRef, useEffect, useCallback } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { getAlistToken } from '../utils/alistApi';
import { saveWatchPosition } from '../utils/watchHistory';
import type { PlayerAPI } from '../hooks/useSync';

interface VideoPlayerProps {
  src: string | null;
  onPlay?: () => void;
  onPause?: () => void;
  onSeeked?: () => void;
  onReady?: (api: PlayerAPI) => void;
  onRetry?: () => Promise<string>;
  /** 字幕 URL（.vtt / .srt） */
  subtitleUrl?: string | null;
  /** 续播起始位置（秒），命中 watchHistory 时传入 */
  resumePosition?: number;
}

const MAX_RETRY = 3;

// ── 可复用：创建 PlayerAPI ──
function createPlayerAPI(art: Artplayer): PlayerAPI {
  return {
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
}

// ── 可复用：HLS handler ──
function createHlsHandler(alistToken: string) {
  return function hlsHandler(video: HTMLVideoElement, url: string) {
    if (!Hls.isSupported()) {
      (video as any).type = 'application/x-mpegURL';
      video.src = url;
      return;
    }
    video.crossOrigin = 'anonymous';
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      xhrSetup: (xhr) => { if (alistToken) xhr.setRequestHeader('Authorization', alistToken); },
    });
    hls.on(Hls.Events.ERROR, () => {
      // 致命错误时触发 ArtPlayer error 事件，接 retry 链路
      hls.destroy();
      // 通过 video 触发 MediaError 让浏览器抛出 error 事件
      if (video.error) return;
      video.dispatchEvent(new Event('error'));
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  };
}

// ── 可复用：绑定播放器事件 ──
interface PlayerEventBindings {
  onPlay?: () => void;
  onPause?: () => void;
  onSeeked?: () => void;
  onReady?: (api: PlayerAPI) => void;
}

function bindPlayerEvents(art: Artplayer, opts: PlayerEventBindings) {
  const api = createPlayerAPI(art);
  opts.onReady?.(api);

  art.on('video:playing', () => opts.onPlay?.());
  art.on('video:pause', () => opts.onPause?.());
  art.on('video:seeked', () => opts.onSeeked?.());
}

export default function VideoPlayer({ src, onPlay, onPause, onSeeked, onReady, onRetry, subtitleUrl, resumePosition }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<Artplayer | null>(null);
  const retryCountRef = useRef(0);
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onSeekedRef = useRef(onSeeked);
  const onReadyRef = useRef(onReady);
  onPlayRef.current = onPlay;
  onPauseRef.current = onPause;
  onSeekedRef.current = onSeeked;
  onReadyRef.current = onReady;

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
    const hlsHandler = createHlsHandler(alistToken);

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
      theme: '#06B6D4',
      lang: 'zh-cn',
      moreVideoAttr: {
        playsInline: true,
        'referrerpolicy': 'no-referrer',
      },
      // ArtPlayer 原生字幕支持
      ...(subtitleUrl ? {
        subtitle: {
          url: subtitleUrl,
          type: subtitleUrl.endsWith('.srt') ? 'srt' : 'vtt',
          encoding: 'utf-8',
        },
      } : {}),
      ...(isHls ? { customType: { m3u8: hlsHandler } } : {}),
    } as any);

    if (art.video) {
      art.video.setAttribute('referrerpolicy', 'no-referrer');
    }
    artRef.current = art;

    // 绑定事件（可复用函数）
    bindPlayerEvents(art, {
      onPlay: onPlayRef.current,
      onPause: onPauseRef.current,
      onSeeked: onSeekedRef.current,
      onReady: onReadyRef.current,
    });

    // 续播：跳转到上次暂停位置
    if (resumePosition && resumePosition > 0) {
      art.seek = resumePosition;
    }

    // 进度记忆：每 10s 保存当前位置
    const saveInterval = window.setInterval(() => {
      if (art.video && !art.video.paused && art.currentTime > 0) {
        saveWatchPosition(src, (art.option as any).title || '', art.currentTime);
      }
    }, 10000);

    // ── 错误处理（HLS fatal → error 事件 + doRetry → 回退 UI） ──
    art.on('error', () => {
      const ve = art.video?.error;
      const names = ['', 'MEDIA_ERR_ABORTED', 'MEDIA_ERR_NETWORK', 'MEDIA_ERR_DECODE', 'MEDIA_ERR_SRC_NOT_SUPPORTED'];
      const codeName = ve?.code ? names[ve.code] || 'UNKNOWN' : 'UNKNOWN';

      if (doRetry(art, src)) return;

      art.template.$container.innerHTML = `
        <div style="color:#fff;text-align:center;padding:32px 20px;background:#0D0D0D;border-radius:16px;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:4px;">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p style="font-size:15px;font-weight:600;color:#fff;margin:0;">视频加载失败</p>
          <p style="font-size:12px;color:#A1A1AA;margin:0;">${codeName}${ve?.message ? ': ' + ve.message : ''}</p>
          <p style="font-size:11px;color:#52525B;margin:0;">已重试 ${MAX_RETRY} 次</p>
          ${onRetryRef.current ? `
            <button id="zlplay-retry-btn" style="margin-top:12px;padding:8px 24px;background:transparent;color:#06B6D4;border:1px solid #06B6D4;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;transition:all 200ms;">
              重新获取链接
            </button>
          ` : '<p style="font-size:11px;color:#52525B;margin-top:8px;">请返回视频列表重新选择</p>'}
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

            const isHlsNew = newUrl.endsWith('.m3u8');
            const newArt = new Artplayer({
              container: containerRef.current!,
              url: newUrl,
              type: isHlsNew ? 'm3u8' : 'auto',
              autoplay: true,
              autoSize: false,
              theme: '#06B6D4',
              lang: 'zh-cn',
              moreVideoAttr: { playsInline: true, 'referrerpolicy': 'no-referrer' },
              ...(subtitleUrl ? {
                subtitle: {
                  url: subtitleUrl,
                  type: subtitleUrl.endsWith('.srt') ? 'srt' : 'vtt',
                  encoding: 'utf-8',
                },
              } : {}),
              ...(isHlsNew ? { customType: { m3u8: createHlsHandler(getAlistToken()) } } : {}),
            } as any);

            if (newArt.video) newArt.video.setAttribute('referrerpolicy', 'no-referrer');
            artRef.current = newArt;

            // 重新绑定全部事件（修复 CRITICAL-2）
            bindPlayerEvents(newArt, {
              onPlay: onPlayRef.current,
              onPause: onPauseRef.current,
              onSeeked: onSeekedRef.current,
              onReady: onReadyRef.current,
            });

            // 绑定 error 事件（递归调用自身需要重新绑定）
            newArt.on('error', () => {
              const ve2 = newArt.video?.error;
              const cn = ve2?.code ? ['', 'MEDIA_ERR_ABORTED', 'MEDIA_ERR_NETWORK', 'MEDIA_ERR_DECODE', 'MEDIA_ERR_SRC_NOT_SUPPORTED'][ve2.code] || 'UNKNOWN' : 'UNKNOWN';
              newArt.template.$container.innerHTML = `
                <div style="color:#fff;text-align:center;padding:32px 20px;background:#0D0D0D;border-radius:16px;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <p style="font-size:15px;font-weight:600;color:#fff;margin-top:8px;">视频加载失败</p>
                  <p style="font-size:12px;color:#A1A1AA;margin:4px 0;">${cn}${ve2?.message ? ': ' + ve2.message : ''}</p>
                  <p style="font-size:11px;color:#52525B;">请返回视频列表重新选择</p>
                </div>`;
            });
          } catch (err) {
            console.error('[Player] retry failed:', err);
            btn.textContent = '重试失败';
            (btn as HTMLButtonElement).disabled = false;
          }
        };
      }
    });

    return () => {
      clearInterval(saveInterval);
      if (artRef.current) {
        // 销毁前保存进度
        if (artRef.current.currentTime > 0 && artRef.current.video) {
          saveWatchPosition(src, '', artRef.current.currentTime);
        }
        artRef.current.destroy();
        artRef.current = null;
      }
    };
  }, [src, doRetry, subtitleUrl, resumePosition]);

  if (!src) {
    return (
      <div
        className="w-full max-w-4xl mx-auto aspect-video max-h-full bg-base rounded-[16px] flex items-center justify-center overflow-hidden border border-base"
        style={{ isolation: 'isolate' as any, position: 'relative', zIndex: 0 }}
      >
        <div className="text-center text-secondary">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <p className="text-sm">选择视频开始播放</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full max-w-5xl mx-auto aspect-video max-h-full rounded-[16px] overflow-hidden bg-base border border-base"
      style={{ isolation: 'isolate' as any, position: 'relative', zIndex: 0 }}
    />
  );
}
