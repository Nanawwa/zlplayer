import type { AlistItem, AlistListResponse, AlistFileInfoResponse } from '../types';

/**
 * Alist API 封装
 * 假设 Alist 提供标准的 /api/fs/list 和 /api/fs/get 接口
 */

const DEFAULT_ALIST_URL = '';

/**
 * 设置 Alist 基础地址（存储在 localStorage）
 */
export function getAlistBaseUrl(): string {
  try {
    return localStorage.getItem('zlplay_alist_url') || DEFAULT_ALIST_URL;
  } catch {
    return DEFAULT_ALIST_URL;
  }
}

/**
 * 格式化 Alist URL：自动补全协议、去除尾部斜杠
 */
export function formatAlistUrl(input: string): string {
  let url = input.trim();
  if (!url) return '';

  // 自动补全协议
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  // 去除尾部斜杠
  url = url.replace(/\/+$/, '');

  return url;
}

export function setAlistBaseUrl(url: string): void {
  localStorage.setItem('zlplay_alist_url', formatAlistUrl(url));
}

/**
 * 设置 Alist Token（存储在 localStorage）
 */
export function getAlistToken(): string {
  try {
    return localStorage.getItem('zlplay_alist_token') || '';
  } catch {
    return '';
  }
}

export function setAlistToken(token: string): void {
  localStorage.setItem('zlplay_alist_token', token);
}

/**
 * Alist 用户名密码登录
 * 调用 /api/auth/login 获取 token
 * Alist v3 返回格式: { code: 200, data: { token: "..." } }
 */
export async function login(
  username: string,
  password: string
): Promise<{ token: string }> {
  const baseUrl = getAlistBaseUrl();
  if (!baseUrl) {
    throw new Error('请先设置 Alist 服务器地址');
  }

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error(`登录失败: HTTP ${res.status}`);
  }

  const data = await res.json();

  // Alist v3 响应格式: { code: 200, message: "success", data: { token: "..." } }
  if (data.code === 200 && data.data?.token) {
    setAlistToken(data.data.token);
    return { token: data.data.token };
  }

  throw new Error(data.message || '登录失败，用户名或密码错误');
}

/**
 * 通用请求封装
 */
async function alistRequest<T>(
  endpoint: string,
  body?: Record<string, unknown>,
  method: 'GET' | 'POST' = 'POST'
): Promise<T> {
  const baseUrl = getAlistBaseUrl();
  if (!baseUrl) {
    throw new Error('请先设置 Alist 服务器地址');
  }

  const token = getAlistToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = token;
  }

  const url = `${baseUrl}/api/${endpoint}`;
  const options: RequestInit = {
    method,
    headers,
  };

  if (method === 'POST' && body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`Alist API 请求失败: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * 列出目录内容
 * @param path - 目录路径，如 / 表示根目录
 * @param page - 页码，从 1 开始
 * @param perPage - 每页数量
 * @param password - 可选密码（如果目录有密码保护）
 */
export async function listDirectory(
  path: string = '/',
  page: number = 1,
  perPage: number = 50,
  password: string = ''
): Promise<AlistListResponse> {
  const body: Record<string, unknown> = {
    path,
    page,
    per_page: perPage,
  };
  if (password) {
    body.password = password;
  }
  return alistRequest<AlistListResponse>('fs/list', body);
}

/**
 * 获取文件详情（获取直链）
 * @param path - 文件完整路径
 * @param password - 可选密码
 */
export async function getFileInfo(
  path: string,
  password: string = ''
): Promise<AlistFileInfoResponse> {
  const body: Record<string, unknown> = { path };
  if (password) {
    body.password = password;
  }
  return alistRequest<AlistFileInfoResponse>('fs/get', body);
}

/**
 * 搜索文件
 * @param keyword - 搜索关键词
 * @param parent - 搜索范围，默认根目录
 * @param page - 页码
 * @param perPage - 每页数量
 */
export async function searchFiles(
  keyword: string,
  parent: string = '/',
  page: number = 1,
  perPage: number = 50
): Promise<AlistListResponse> {
  return alistRequest<AlistListResponse>('fs/search', {
    parent,
    keywords: keyword,
    page,
    per_page: perPage,
  });
}

/**
 * 获取视频播放链接
 * 1. 调 /api/fs/get 拿 raw_url（云盘已签名直链，如中国移动云盘）
 * 2. 没有 raw_url 则走 /d/ 原始链接
 * @param path - Alist 文件路径
 */
export async function getPlayUrl(path: string): Promise<string> {
  const baseUrl = getAlistBaseUrl();
  if (!baseUrl) {
    throw new Error('请先设置 Alist 服务器地址');
  }

  const cleanPath = encodeURI(path.startsWith('/') ? path : `/${path}`);
  const token = getAlistToken();
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';

  try {
    const info = await getFileInfo(path);
    if (info.code === 200 && info.data?.raw_url) {
      return info.data.raw_url;
    }
  } catch (e) {
    console.warn('[Alist] /api/fs/get 失败:', e);
  }

  return `${baseUrl}/d${cleanPath}${tokenQuery}`;
}

/**
 * 同步构造直链（简单场景用）
 * @deprecated 推荐使用 getPlayUrl() 异步获取真实播放链接
 */
export function getDirectUrl(path: string): string {
  const baseUrl = getAlistBaseUrl();
  const cleanPath = encodeURI(path.startsWith('/') ? path : `/${path}`);
  const token = getAlistToken();
  const sep = cleanPath.includes('?') ? '&' : '?';
  const query = token ? `${sep}token=${encodeURIComponent(token)}` : '';
  return `${baseUrl}/p${cleanPath}${query}`;
}

/**
 * 判断文件是否为视频类型
 */
const VIDEO_EXTENSIONS = [
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv',
  '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.m3u8',
];

export function isVideoFile(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop();
  if (!ext) return false;
  return VIDEO_EXTENSIONS.includes(`.${ext}`);
}
