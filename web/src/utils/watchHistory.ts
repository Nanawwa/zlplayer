/**
 * 播放进度记忆
 * localStorage 存储 { url, title, position, timestamp } 列表（cap 50，按 url 去重）
 */

const STORAGE_KEY = 'zlplay_watch_history';
const MAX_ITEMS = 50;

interface WatchEntry {
  url: string;
  title: string;
  position: number;   // 秒
  timestamp: number;  // Date.now()
}

function readAll(): WatchEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: WatchEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* ignore */ }
}

export function getWatchPosition(url: string): WatchEntry | null {
  const entries = readAll();
  return entries.find((e) => e.url === url) || null;
}

export function saveWatchPosition(url: string, title: string, position: number): void {
  const entries = readAll();
  // 去重：按 url
  const filtered = entries.filter((e) => e.url !== url);
  filtered.unshift({ url, title, position, timestamp: Date.now() });
  if (filtered.length > MAX_ITEMS) filtered.length = MAX_ITEMS;
  writeAll(filtered);
}

export function formatPosition(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
