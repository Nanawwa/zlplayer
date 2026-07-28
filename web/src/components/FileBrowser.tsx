import { useState, useCallback, useEffect } from 'react';
import { listDirectory, searchFiles, getPlayUrl, isVideoFile } from '../utils/alistApi';
import type { AlistItem } from '../types';
import { IconFolder, IconSearch, IconArrowLeft, IconVideo, IconFile, IconEmpty, IconLoader } from './Icons';

interface FileBrowserProps {
  onPlayVideo: (url: string, title: string) => void;
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
    setPathStack(prev => [...prev, currentPath]);
    doLoad(newPath);
  }, [currentPath, doLoad]);

  const goBack = useCallback(() => {
    if (pathStack.length === 0) return;
    const prev = pathStack[pathStack.length - 1];
    setPathStack(prev => prev.slice(0, -1));
    doLoad(prev);
  }, [pathStack, doLoad]);

  const handlePlay = useCallback(async (item: AlistItem) => {
    const filePath = currentPath === '/' ? `/${item.name}` : `${currentPath}/${item.name}`;
    setLoadingUrl(item.name);
    setError(null);
    try {
      const url = await getPlayUrl(filePath);
      onPlayVideo(url, item.name);
    } catch (e) {
      setError(`获取播放链接失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setLoadingUrl(null);
    }
  }, [currentPath, onPlayVideo]);

  useEffect(() => { doLoad('/'); }, [doLoad]);

  const formatSize = (bytes: number): string => {
    if (!bytes) return '-';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${u[i]}`;
  };

  const inputCls = compact
    ? 'flex-1 px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500'
    : 'flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500';

  const btnCls = compact
    ? 'px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors'
    : 'px-3 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors';

  return (
    <div className="h-full flex flex-col">
      {/* search bar */}
      <div className={`flex gap-2 ${compact ? 'mb-1.5' : 'mb-3'}`}>
        <input type="text" value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="搜索视频..."
          className={inputCls} />
        <button onClick={handleSearch} className={btnCls}>
          <IconSearch size={compact ? 14 : 16} />
        </button>
      </div>

      {/* path nav */}
      <div className={`flex items-center gap-2 ${compact ? 'mb-1' : 'mb-3'}`}>
        {pathStack.length > 0 && (
          <button onClick={goBack}
            className={`inline-flex items-center gap-1 ${compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'} text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors`}>
            <IconArrowLeft size={12} /> 返回
          </button>
        )}
        <span className={`text-gray-400 dark:text-gray-500 font-mono truncate bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-0.5 ${compact ? 'text-[10px]' : 'text-xs'}`}>
          {currentPath}
        </span>
      </div>

      {/* error */}
      {error && (
        <div className={`text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md ${compact ? 'mb-1 p-1.5 text-xs' : 'mb-3 p-2.5 text-sm'}`}>
          {error}
        </div>
      )}

      {/* file list */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700"
        style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-gray-400 text-sm">
            <IconLoader size={16} /> 加载中
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-300 dark:text-gray-600">
            <IconEmpty size={36} />
            <p className={`mt-2 ${compact ? 'text-xs' : 'text-sm'}`}>此目录为空</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
            {items
              .sort((a, b) => { if (a.is_dir && !b.is_dir) return -1; if (!a.is_dir && b.is_dir) return 1; return a.name.localeCompare(b.name); })
              .map(item => {
                const isVideo = isVideoFile(item.name);
                const clickable = item.is_dir || isVideo;
                return (
                  <div key={item.name}
                    onClick={() => { if (item.is_dir) enterDir(item); else if (isVideo) handlePlay(item); }}
                    className={`flex items-center gap-2 transition-colors select-none
                      ${compact ? 'px-2 py-1.5' : 'px-3 py-2.5'}
                      ${clickable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50' : 'opacity-30 cursor-default'}`}>
                    <div className="flex-shrink-0 text-gray-400 dark:text-gray-500">
                      {item.is_dir ? <IconFolder size={compact ? 16 : 18} /> : isVideo ? <IconVideo size={compact ? 16 : 18} className="text-blue-500" /> : <IconFile size={compact ? 16 : 18} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-medium text-gray-800 dark:text-gray-200 truncate ${compact ? 'text-xs' : 'text-sm'}`}>
                        {item.name}
                      </div>
                      {!compact && (
                        <div className="text-xs text-gray-400 dark:text-gray-500">
                          {item.is_dir ? '目录' : formatSize(item.size)}
                          {item.modified && ` · ${item.modified}`}
                        </div>
                      )}
                    </div>
                    {isVideo && (
                      loadingUrl === item.name
                        ? <IconLoader size={14} className="text-blue-500 flex-shrink-0" />
                        : <span className="text-blue-500 text-xs flex-shrink-0 font-medium">播放</span>
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
