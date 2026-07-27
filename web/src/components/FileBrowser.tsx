import { useState, useCallback, useEffect } from 'react';
import { listDirectory, searchFiles, getPlayUrl, isVideoFile } from '../utils/alistApi';
import type { AlistItem } from '../types';

interface FileBrowserProps {
  /** 选中视频后的回调 */
  onPlayVideo: (url: string, title: string) => void;
  /** 是否紧凑模式（在 RoomPage 侧边栏中使用） */
  compact?: boolean;
}

/**
 * 可复用的 Alist 文件浏览器
 * 用于 HomePage 和 RoomPage
 */
export default function FileBrowser({ onPlayVideo, compact = false }: FileBrowserProps) {
  const [items, setItems] = useState<AlistItem[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [pathStack, setPathStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null); // 正在获取播放链接的文件名

  // 加载目录
  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listDirectory(path);
      if (res.code === 200) {
        setItems(res.data.content || []);
        setCurrentPath(path);
      } else {
        setError(`加载失败: ${res.message || '未知错误'} (code=${res.code})`);
      }
    } catch (e) {
      setError(`连接 Alist 失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 搜索
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      loadDirectory(currentPath);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await searchFiles(searchQuery, currentPath);
      if (res.code === 200) {
        setItems(res.data.content || []);
      } else {
        setError(`搜索失败: ${res.message || '未知错误'}`);
      }
    } catch (e) {
      setError(`搜索失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, currentPath, loadDirectory]);

  // 进入子目录
  const handleEnterDir = useCallback(
    (item: AlistItem) => {
      if (!item.is_dir) return;
      const newPath = currentPath === '/'
        ? `/${item.name}`
        : `${currentPath}/${item.name}`;
      setPathStack((prev) => [...prev, currentPath]);
      loadDirectory(newPath);
    },
    [currentPath, loadDirectory]
  );

  // 返回上级目录
  const handleGoBack = useCallback(() => {
    if (pathStack.length === 0) return;
    const prevPath = pathStack[pathStack.length - 1];
    setPathStack((prev) => prev.slice(0, -1));
    loadDirectory(prevPath);
  }, [pathStack, loadDirectory]);

  // 播放视频：先调用 Alist API 获取真实播放链接
  const handlePlayClick = useCallback(
    async (item: AlistItem) => {
      const filePath = currentPath === '/'
        ? `/${item.name}`
        : `${currentPath}/${item.name}`;

      setLoadingUrl(item.name);
      setError(null);

      try {
        const url = await getPlayUrl(filePath);
        console.log('[FileBrowser] 获取到播放链接:', url);
        onPlayVideo(url, item.name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '未知错误';
        setError(`获取播放链接失败: ${msg}`);
        console.error('[FileBrowser] 获取播放链接失败:', e);
      } finally {
        setLoadingUrl(null);
      }
    },
    [currentPath, onPlayVideo]
  );

  // 组件挂载时自动加载根目录
  useEffect(() => {
    loadDirectory('/');
  }, [loadDirectory]);

  // 格式化文件大小
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  };

  const containerClass = compact
    ? 'h-full flex flex-col'
    : '';

  return (
    <div className={containerClass}>
      {/* 搜索栏 */}
      <div className={`flex gap-2 ${compact ? 'mb-2' : 'mb-4'}`}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="搜索视频..."
          className={`flex-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500 ${compact ? 'px-2 py-1 text-xs' : 'px-4 py-2 text-sm'}`}
        />
        <button
          onClick={handleSearch}
          className={`bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 ${compact ? 'px-2 py-1 text-xs' : 'px-4 py-2 text-sm'}`}
        >
          🔍
        </button>
      </div>

      {/* 路径导航 */}
      <div className={`flex items-center gap-2 ${compact ? 'mb-1' : 'mb-4'}`}>
        {pathStack.length > 0 && (
          <button
            onClick={handleGoBack}
            className={`bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors ${compact ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'}`}
          >
            ← 返回
          </button>
        )}
        <span className={`text-gray-500 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-800 rounded truncate ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'}`}>
          {currentPath}
        </span>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className={`text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg ${compact ? 'mb-1 p-2 text-xs' : 'mb-4 p-3 text-sm'}`}>
          {error}
        </div>
      )}

      {/* 文件列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-gray-500 dark:text-gray-400 text-sm">加载中...</span>
          </div>
        ) : items.length === 0 ? (
          <div className={`text-center text-gray-400 dark:text-gray-500 ${compact ? 'py-8' : 'py-16'}`}>
            <p className={compact ? 'text-sm' : 'text-lg'}>📭 此目录为空</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {items
              .sort((a, b) => {
                if (a.is_dir && !b.is_dir) return -1;
                if (!a.is_dir && b.is_dir) return 1;
                return a.name.localeCompare(b.name);
              })
              .map((item) => (
                <div
                  key={item.name}
                  onClick={() => {
                    if (item.is_dir) {
                      handleEnterDir(item);
                    } else if (isVideoFile(item.name)) {
                      handlePlayClick(item);
                    }
                  }}
                  className={`flex items-center gap-2 transition-colors ${
                    compact ? 'px-2 py-1.5' : 'px-4 py-3'
                  } ${
                    item.is_dir || isVideoFile(item.name)
                      ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      : 'opacity-40 cursor-default'
                  }`}
                >
                  {/* 图标 */}
                  <div className={`flex-shrink-0 flex items-center justify-center ${compact ? 'text-base' : 'text-xl'}`}>
                    {item.is_dir ? '📁' : isVideoFile(item.name) ? '🎬' : '📄'}
                  </div>

                  {/* 信息 */}
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

                  {/* 视频文件：加载中显示 spinner，否则显示 ▶ */}
                  {isVideoFile(item.name) && (
                    loadingUrl === item.name ? (
                      <span className="flex-shrink-0 w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span className="text-primary-500 text-sm flex-shrink-0">▶</span>
                    )
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
