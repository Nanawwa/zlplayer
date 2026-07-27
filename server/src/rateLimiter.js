'use strict';

/**
 * 速率限制器：每个连接每秒最多 N 条消息
 */
class RateLimiter {
  /**
   * @param {number} maxPerSecond - 每秒最大消息数
   */
  constructor(maxPerSecond = 10) {
    this.maxPerSecond = maxPerSecond;
    /** @type {Map<string, {count: number, resetAt: number}>} */
    this.clients = new Map();
  }

  /**
   * 检查指定客户端是否超出速率限制
   * @param {string} clientId - 客户端标识（如 IP 或连接 ID）
   * @returns {boolean} true 表示允许通过，false 表示超出限制
   */
  check(clientId) {
    const now = Date.now();
    let record = this.clients.get(clientId);

    if (!record || now >= record.resetAt) {
      // 过期或新客户端，重置计数
      record = { count: 1, resetAt: now + 1000 };
      this.clients.set(clientId, record);
      return true;
    }

    record.count++;
    if (record.count > this.maxPerSecond) {
      return false;
    }

    return true;
  }

  /**
   * 移除客户端记录
   * @param {string} clientId
   */
  remove(clientId) {
    this.clients.delete(clientId);
  }

  /**
   * 定期清理过期记录
   */
  cleanup() {
    const now = Date.now();
    for (const [clientId, record] of this.clients.entries()) {
      if (now >= record.resetAt) {
        this.clients.delete(clientId);
      }
    }
  }
}

module.exports = { RateLimiter };
