/** WebSocket 消息类型 */
export type WSMessageType =
  | 'create_room'
  | 'join_room'
  | 'leave_room'
  | 'destroy_room'
  | 'room_created'
  | 'room_destroyed'
  | 'member_joined'
  | 'member_left'
  | 'owner_changed'
  | 'left_room'
  | 'play'
  | 'pause'
  | 'seek'
  | 'change_video'
  | 'request_sync'
  | 'sync_response'
  | 'chat'
  | 'ping'
  | 'pong'
  | 'connected'
  | 'error'
  | 'server_shutdown'
  | 'list_rooms'
  | 'room_list'
  // 预留：权限与角色相关
  | 'kick_member'
  | 'kicked'
  | 'mute_member'
  | 'role_update';

/** 服务器发来的消息 */
export interface WSMessage {
  type: WSMessageType;
  [key: string]: unknown;
}

/** 房间成员 */
export interface Member {
  id: string;
  name: string;
  joinedAt: number;
}

/** 播放器状态 */
export interface PlayerState {
  playing: boolean;
  position: number;
  timestamp: number;
}

/** 视频信息 */
export interface VideoInfo {
  url: string;
  title: string;
}

/** 房间状态（sync_response 返回） */
export interface SyncResponse {
  code: string;
  ownerId: string;
  members: Member[];
  currentVideo: VideoInfo | null;
  playerState: PlayerState;
}

/** 可发现的房间摘要 */
export interface RoomSummary {
  code: string;
  memberCount: number;
  videoTitle: string | null;
  ownerName: string;
}

/** 聊天消息 */
export interface ChatMessage {
  senderId: string;
  senderName: string;
  message: string;
  timestamp: number;
}

/** Alist 文件/目录项 */
export interface AlistItem {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
  sign?: string;
  thumb?: string;
  type: number;
  hashinfo?: string;
  raw_url?: string;
}

/** Alist 列出目录的 API 响应 */
export interface AlistListResponse {
  code: number;
  message: string;
  data: {
    content: AlistItem[];
    total: number;
    readme?: string;
    write?: boolean;
    provider?: string;
  };
}

/** Alist 获取文件信息的 API 响应 */
export interface AlistFileInfoResponse {
  code: number;
  message: string;
  data: {
    name: string;
    size: number;
    is_dir: boolean;
    modified: string;
    raw_url?: string;
  };
}
