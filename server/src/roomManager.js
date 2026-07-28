'use strict';

/**
 * 房间管理模块
 * 负责房间的创建、加入、离开、解散、房主转移、空闲清理
 */

// 生成房间码的字符集（排除 O/0/I/1 避免混淆）
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

/**
 * 生成随机房间码
 * @returns {string} 6 位房间码
 */
function generateRoomCode() {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const idx = Math.floor(Math.random() * ROOM_CODE_CHARS.length);
    code += ROOM_CODE_CHARS[idx];
  }
  return code;
}

/**
 * 房间管理类
 */
class RoomManager {
  constructor(options = {}) {
    this.maxRooms = options.maxRooms || 200;
    this.roomTimeout = (options.roomTimeout || 300) * 1000; // 转换为毫秒
    this.heartbeatTimeout = options.heartbeatTimeout || 60000;

    /** @type {Map<string, Room>} */
    this.rooms = new Map();

    /** @type {number} */
    this.totalMessages = 0;

    // 定期清理空闲房间
    this.cleanupInterval = setInterval(() => this.cleanupIdleRooms(), 60000);
  }

  /**
   * 创建房间
   * @param {object} opts
   * @param {string} opts.password - 可选密码
   * @param {object} opts.owner - 房主的 ws 连接对象
   * @returns {{code: string, room: object}} 创建结果
   */
  createRoom({ password = '', owner }) {
    if (this.rooms.size >= this.maxRooms) {
      throw new Error('房间数已达上限，请稍后再试');
    }

    let code;
    let attempts = 0;
    const maxAttempts = 10;

    // 生成唯一房间码，最多重试 10 次
    do {
      code = generateRoomCode();
      attempts++;
      if (attempts > maxAttempts) {
        throw new Error('生成房间码失败，请重试');
      }
    } while (this.rooms.has(code));

    const room = {
      code,
      password: password || '',
      ownerId: owner.id,
      members: new Map(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      currentVideo: null, // { url: string, title: string }
      playerState: {
        playing: false,
        position: 0,
        timestamp: Date.now(),
      },
    };

    this.rooms.set(code, room);
    this.log(`房间 ${code} 已创建，房主: ${owner.id}`);
    return { code, room };
  }

  /**
   * 加入房间
   * @param {string} code - 房间码
   * @param {string} password - 密码
   * @param {object} member - 成员 ws 连接对象
   * @param {string} memberName - 成员昵称
   * @returns {object} 房间对象
   */
  joinRoom(code, password, member, memberName = '') {
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error('房间不存在或已解散');
    }

    if (room.password && room.password !== password) {
      throw new Error('房间密码错误');
    }

    const memberInfo = {
      id: member.id,
      name: memberName || `用户_${member.id.slice(0, 4)}`,
      joinedAt: Date.now(),
      ws: member,
    };

    room.members.set(member.id, memberInfo);
    room.lastActivity = Date.now();
    this.log(`用户 ${memberInfo.name}(${member.id}) 加入房间 ${code}`);

    return room;
  }

  /**
   * 离开房间
   * @param {string} code - 房间码
   * @param {string} memberId - 成员 ID
   */
  leaveRoom(code, memberId) {
    const room = this.rooms.get(code);
    if (!room) return;

    const member = room.members.get(memberId);
    room.members.delete(memberId);
    room.lastActivity = Date.now();

    this.log(`用户 ${member?.name || memberId} 离开房间 ${code}`);

    // 如果房间空了，删除
    if (room.members.size === 0) {
      return this.destroyRoom(code);
    }

    // 如果是房主离开，转移房主给最早加入的成员
    if (room.ownerId === memberId) {
      this.transferOwnership(code);
    }
  }

  /**
   * 转移房主
   * @param {string} code - 房间码
   */
  transferOwnership(code) {
    const room = this.rooms.get(code);
    if (!room || room.members.size === 0) return;

    // 按加入时间排序，选最早的成员作为新房主
    const members = [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    const newOwner = members[0];
    room.ownerId = newOwner.id;
    this.log(`房间 ${code} 房主已转移给 ${newOwner.name}(${newOwner.id})`);
  }

  /**
   * 解散房间（仅限房主）
   * @param {string} code - 房间码
   * @param {string} requesterId - 请求者 ID
   */
  destroyRoom(code, requesterId) {
    const room = this.rooms.get(code);
    if (!room) return;

    // 如果传了 requesterId 则验证权限；不传则直接删除（用于系统清理）
    if (requesterId && room.ownerId !== requesterId) {
      throw new Error('仅房主可以解散房间');
    }

    this.rooms.delete(code);
    this.log(`房间 ${code} 已解散`);
    return room;
  }

  /**
   * 获取房间信息
   * @param {string} code
   * @returns {object|undefined}
   */
  getRoom(code) {
    return this.rooms.get(code);
  }

  /**
   * 更新房间活动时间
   * @param {string} code
   */
  touchRoom(code) {
    const room = this.rooms.get(code);
    if (room) {
      room.lastActivity = Date.now();
    }
  }

  /**
   * 更新房间播放状态
   * @param {string} code
   * @param {object} state
   */
  updatePlayerState(code, state) {
    const room = this.rooms.get(code);
    if (!room) return;

    room.playerState = {
      ...room.playerState,
      ...state,
    };
    room.lastActivity = Date.now();
  }

  /**
   * 设置房间当前视频
   * @param {string} code
   * @param {{url: string, title: string}} video
   */
  setCurrentVideo(code, video) {
    const room = this.rooms.get(code);
    if (!room) return;

    room.currentVideo = video;
    room.lastActivity = Date.now();
  }

  /**
   * 增加消息计数
   */
  incrementMessageCount() {
    this.totalMessages++;
  }

  /**
   * 获取可发现的房间列表（公开、非空房间）
   */
  getDiscoverableRooms() {
    const list = [];
    for (const room of this.rooms.values()) {
      if (room.members.size === 0) continue;
      if (room.password) continue; // 有密码不公开
      const owner = room.members.get(room.ownerId);
      list.push({
        code: room.code,
        memberCount: room.members.size,
        videoTitle: room.currentVideo?.title || null,
        ownerName: owner?.name || '未知',
      });
    }
    return list;
  }

  /**
   * 获取统计信息
   * @returns {{ rooms: number, online: number, totalMessages: number }}
   */
  getStats() {
    let online = 0;
    for (const room of this.rooms.values()) {
      online += room.members.size;
    }
    return {
      rooms: this.rooms.size,
      online,
      totalMessages: this.totalMessages,
    };
  }

  /**
   * 清理空闲房间
   */
  cleanupIdleRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (room.members.size === 0 && now - room.lastActivity > this.roomTimeout) {
        this.rooms.delete(code);
        this.log(`空闲房间 ${code} 已自动清理`);
      }
    }
  }

  /**
   * 带时间戳的日志输出
   * @param {string} message
   * @param {string} level
   */
  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '📌';
    // eslint-disable-next-line no-console
    console.log(`[${timestamp}] ${prefix} ${message}`);
  }

  /**
   * 停止清理定时器（用于优雅关闭）
   */
  shutdown() {
    clearInterval(this.cleanupInterval);
  }
}

module.exports = { RoomManager, generateRoomCode };
