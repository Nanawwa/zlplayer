import { useState, useCallback, useEffect } from 'react';
import { listDirectory, searchFiles, getPlayUrl, isVideoFile, findSubtitle, getSubtitleUrl } from '../utils/alistApi';
import type { AlistItem } from '../types';
import { getWatchPosition, formatPosition } from '../utils/watchHistory';
import { IconFolder, IconSearch, IconArrowLeft, IconVideo, IconFile, IconEmpty, IconLoader } from './Icons';

interface FileBrowserProps {
  onPlayVideo: (url: string, title: string, subtitleUrl?: string | null, startPosition?: number) => void;
  compact?: boolean;
}

export default function FileBrowser({ onPlayVideo, compact = false }: FileBrowserProps) {
  const [items, setItems] = useState<AlistItem[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [pathStack, setPathStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);

  const doLoad = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listDirectory(path);
      if (res.code === 200) {
        setItems(res.data.content || []);
        setCurrentPath(path);
      } else {
        setError(`加载失败 (code=${res.code})`);
      }
    } catch (e) {
      setError(`连接失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) { doLoad(currentPath); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await searchFiles(searchQuery, currentPath);
      if (res.code === 200) setItems(res.data.content || []);
      else setError(`搜索失败 (code=${res.code})`);
    } catch (e) {
      setError(`搜索失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, currentPath, doLoad]);

  const enterDir = useCallback((item: AlistItem) => {
    if (!item.is_dir) return;
    const newPath = currentPath === '/' ? `/${item.name}` : `${currentPath}/${item.name}`;
    setPathStack((prev) => [...prev, currentPath]);
    doLoad(newPath);
  }, [currentPath, doLoad]);

  const goBack = useCallback(() => {
    if (pathStack.length === 0) return;
    const prev = pathStack[pathStack.length - 1];
    setPathStack((prevStack) => prevStack.slice(0, -1));
    doLoad(prev);
  }, [pathStack, doLoad]);

  const handlePlay = useCallback(async (item: AlistItem) => {
    const filePath = currentPath === '/' ? `/${item.name}` : `${currentPath}/${item.name}`;
    setLoadingUrl(item.name);
    setError(null);
    try {
      const url = await getPlayUrl(filePath);

      // 检测同名字幕
      let subtitleUrl: string | null = null;
      const subName = findSubtitle(items, item.name);
      if (subName) {
        const subPath = currentPath === '/' ? `/${subName}` : `${currentPath}/${subName}`;
        subtitleUrl = getSubtitleUrl(subPath);
      }

      // 续播提示
      const existing = getWatchPosition(url);
      let startPos: number | undefined;
      if (existing && existing.position > 5) {
        const resume = confirm(
          `"${item.name}"\n\n上次暂停在 ${formatPosition(existing.position)}\n\n是否继续播放？\n（点击"确定"继续，"取消"从头播放）`
        );
        if (resume) startPos = existing.position;
      }

      onPlayVideo(url, item.name, subtitleUrl, startPos);
    } catch (e) {
      setError(`获取播放链接失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setLoadingUrl(null);
    }
  }, [currentPath, onPlayVideo, items]);

  useEffect(() => { doLoad('/'); }, [doLoad]);

  const formatSize = (bytes: number): string => {
    if (!bytes) return '-';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${u[i]}`;
  };

  // 面包屑分段
  const breadcrumbs = currentPath === '/'
    ? [{ name: '/', path: '/' }]
    : currentPath.split('/').filter(Boolean).reduce<{ name: string; path: string }[]>((acc, seg, i) => {
        const path = i === 0 ? `/${seg}` : `${acc[i - 1].path}/${seg}`;
        acc.push({ name: seg, path });
        return acc;
      }, []);

  return (
    <div className="h-full flex flex-col">
      {/* 搜索框（左侧放大镜图标） */}
      <div className={`flex items-center gap-1.5 bg-elevated rounded-[12px] px-3 ${compact ? 'mb-1.5 py-1' : 'mb-3 py-1.5'}`}>
        <IconSearch size={compact ? 14 : 16} className="text-secondary flex-shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="搜索视频..."
          className="flex-1 bg-transparent text-primary text-sm placeholder-[var(--text-secondary)] focus:outline-none border border-transparent focus:border-[var(--primary-500)] rounded-lg py-1 transition-colors"
        />
      </div>

      {/* 面包屑导航 */}
      <div className={`flex items-center gap-1 flex-wrap ${compact ? 'mb-1' : 'mb-3'}`}>
        {pathStack.length > 0 && (
          <button
            onClick={goBack}
            className={`inline-flex items-center gap-1 ${compact ? 'px-2 py-0.5' : 'px-2.5 py-1'} text-xs text-secondary hover:text-primary bg-elevated hover:bg-card rounded-md transition-colors flex-shrink-0`}
          >
            <IconArrowLeft size={12} /> 返回
          </button>
        )}
        <nav className="flex items-center gap-1 min-w-0 overflow-hidden">
          {breadcrumbs.map((bc, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={bc.path} className="flex items-center gap-1 min-w-0">
                {i > 0 && <span className="text-secondary text-[10px]">/</span>}
                <button
                  onClick={() => !isLast && doLoad(bc.path)}
                  title={bc.path}
                  className={`truncate ${compact ? 'text-[10px]' : 'text-xs'} ${
                    isLast
                      ? 'font-bold text-primary'
                      : 'text-secondary hover:text-primary transition-colors'
                  } ${bc.name === '/' ? '' : 'max-w-[120px]'}`}
                >
                  {bc.name === '/' ? '根目录' : bc.name}
                </button>
              </span>
            );
          })}
        </nav>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className={`text-[#EF4444] bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-[12px] ${compact ? 'mb-1 p-1.5 text-xs' : 'mb-3 p-2.5 text-sm'}`}>
          {error}
        </div>
      )}

      {/* 文件列表 */}
      <div
        className="flex-1 min-h-0 overflow-y-auto bg-card rounded-[12px] border border-base"
        style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-secondary text-sm">
            <IconLoader size={16} className="text-[var(--primary-500)]" /> 加载中...
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-secondary">
            <IconEmpty size={36} className="opacity-40" />
            <p className={`mt-2 ${compact ? 'text-xs' : 'text-sm'}`}>此目录为空</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-color)]/50">
            {items
              .sort((a, b) => { if (a.is_dir && !b.is_dir) return -1; if (!a.is_dir && b.is_dir) return 1; return a.name.localeCompare(b.name); })
              .map((item) => {
                const isVideo = isVideoFile(item.name);
                const clickable = item.is_dir || isVideo;
                return (
                  <div
                    key={item.name}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    aria-label={clickable ? (item.is_dir ? `打开目录 ${item.name}` : `播放 ${item.name}`) : undefined}
                    onClick={() => { if (item.is_dir) enterDir(item); else if (isVideo) handlePlay(item); }}
                    onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (item.is_dir) enterDir(item); else if (isVideo) handlePlay(item); } } : undefined}
                    title={item.name}
                    className={`flex items-center gap-2 transition-colors select-none ${
                      compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
                    } ${
                      clickable
                        ? 'cursor-pointer hover:bg-elevated active:bg-[var(--primary-500)]/10 focus:outline-none focus:ring-1 focus:ring-[var(--primary-500)] focus:bg-elevated'
                        : 'opacity-30 cursor-default'
                    }`}
                  >
                    <div className="flex-shrink-0">
                      {item.is_dir ? (
                        <IconFolder size={compact ? 16 : 18} className="text-[#F59E0B]" />
                      ) : isVideo ? (
                        <IconVideo size={compact ? 16 : 18} className="text-[var(--primary-500)]" />
                      ) : (
                        <IconFile size={compact ? 16 : 18} className="text-secondary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-medium text-primary truncate ${compact ? 'text-xs' : 'text-sm'}`}>
                        {item.name}
                      </div>
                      {!compact && (
                        <div className="text-xs text-secondary">
                          {item.is_dir ? '目录' : formatSize(item.size)}
                          {item.modified && ` · ${item.modified}`}
                        </div>
                      )}
                    </div>
                    {isVideo && (
                      loadingUrl === item.name ? (
                        <IconLoader size={14} className="text-[var(--primary-500)] flex-shrink-0" />
                      ) : (
                        <span className="text-[var(--primary-500)] text-xs flex-shrink-0 font-medium">
                          播放
                        </span>
                      )
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
