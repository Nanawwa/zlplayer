import { create } from 'zustand';
import type { Member, PlayerState, VideoInfo, ChatMessage, RoomSummary } from '../types';

/**
 * 页面路由状态
 */
export type PageView = 'home' | 'room';

interface RoomState {
  /** 当前页面 */
  currentPage: PageView;

  /** 当前房间码 */
  roomCode: string;

  /** 当前用户 ID（由服务器分配或本地生成） */
  myId: string;

  /** 是否房主 */
  isOwner: boolean;

  /** 房主 ID */
  ownerId: string;

  /** 成员列表 */
  members: Member[];

  /** 聊天消息列表 */
  chatMessages: ChatMessage[];

  /** 当前视频 */
  currentVideo: VideoInfo | null;

  /** 播放器状态 */
  playerState: PlayerState;

  /** 是否已连接 WebSocket */
  wsConnected: boolean;

  /** 连接错误 */
  wsError: string | null;

  /** 上次测量的 RTT（秒），由 useWebSocket 心跳更新 */
  wsRtt: number;

  /** 当前房间密码（用于断线重连重新加入，localStorage 持久化） */
  roomPassword: string;

  /** Alist 服务器地址 */
  alistUrl: string;

  /** 可发现的活跃房间 */
  availableRooms: RoomSummary[];

  // actions

  /** 设置当前页面 */
  setPage: (page: PageView) => void;

  /** 设置房间码 */
  setRoomCode: (code: string) => void;

  /** 设置我的 ID */
  setMyId: (id: string) => void;

  /** 设置房主状态 */
  setIsOwner: (v: boolean) => void;

  /** 设置房主 ID */
  setOwnerId: (id: string) => void;

  /** 设置成员列表 */
  setMembers: (members: Member[]) => void;

  /** 添加聊天消息 */
  addChatMessage: (msg: ChatMessage) => void;

  /** 设置当前视频 */
  setCurrentVideo: (video: VideoInfo | null) => void;

  /** 设置播放器状态 */
  setPlayerState: (state: Partial<PlayerState>) => void;

  /** 设置 WebSocket 连接状态 */
  setWsConnected: (v: boolean) => void;

  /** 设置连接错误 */
  setWsError: (err: string | null) => void;

  /** 设置 Alist 地址 */
  setAlistUrl: (url: string) => void;

  /** 设置可用房间列表 */
  setAvailableRooms: (rooms: RoomSummary[]) => void;

  /** 设置 RTT（秒） */
  setWsRtt: (rtt: number) => void;

  /** 设置房间密码（持久化到 localStorage） */
  setRoomPassword: (pw: string) => void;

  /** 重置房间状态 */
  resetRoom: () => void;
}

const initialRoom = {
  currentPage: 'home' as PageView,
  roomCode: '',
  myId: '',
  isOwner: false,
  ownerId: '',
  members: [],
  chatMessages: [],
  currentVideo: null,
  playerState: { playing: false, position: 0, timestamp: 0 },
  wsConnected: false,
  wsError: null,
  wsRtt: 0.1,
  roomPassword: (() => { try { return localStorage.getItem('zlplay_room_password') || ''; } catch { return ''; } })(),
  alistUrl: localStorage.getItem('zlplay_alist_url') || (import.meta.env.VITE_DEFAULT_ALIST_URL as string) || '',
  availableRooms: [],
};

export const useRoomStore = create<RoomState>((set) => ({
  ...initialRoom,

  setPage: (page) => set({ currentPage: page }),

  setRoomCode: (code) => set({ roomCode: code }),

  setMyId: (id) => set({ myId: id }),

  setIsOwner: (v) => set({ isOwner: v }),

  setOwnerId: (id) => set({ ownerId: id }),

  setMembers: (members) => set({ members }),

  addChatMessage: (msg) =>
    set((s) => ({ chatMessages: [...s.chatMessages.slice(-200), msg] })),

  setCurrentVideo: (video) => set({ currentVideo: video }),

  setPlayerState: (state) =>
    set((s) => ({ playerState: { ...s.playerState, ...state } })),

  setWsConnected: (v) => {
    if (v) {
      set({ wsConnected: true, wsError: null });
    } else {
      set({ wsConnected: false });
    }
  },

  setWsError: (err) => set({ wsError: err }),

  setAlistUrl: (url) => {
    localStorage.setItem('zlplay_alist_url', url);
    set({ alistUrl: url });
  },

  setAvailableRooms: (rooms) => set({ availableRooms: rooms }),

  setWsRtt: (rtt) => set({ wsRtt: rtt }),

  setRoomPassword: (pw) => {
    try { localStorage.setItem('zlplay_room_password', pw); } catch { /* ignore */ }
    set({ roomPassword: pw });
  },

  resetRoom: () => {
    try { localStorage.removeItem('zlplay_room_password'); } catch { /* ignore */ }
    set({
      currentPage: 'home',
      roomCode: '',
      isOwner: false,
      ownerId: '',
      members: [],
      chatMessages: [],
      currentVideo: null,
      playerState: { playing: false, position: 0, timestamp: 0 },
      wsError: null,
      roomPassword: '',
    });
  },
}));
