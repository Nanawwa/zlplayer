import { useState, useRef, useEffect, useCallback } from 'react';
import { useRoomStore } from '../store/roomStore';

interface ChatBoxProps {
  sendMessage: (type: string, payload: Record<string, unknown>) => void;
}

/**
 * 聊天组件
 */
export default function ChatBox({ sendMessage }: ChatBoxProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatMessages = useRoomStore((s) => s.chatMessages);
  const myId = useRoomStore((s) => s.myId);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // 发送消息
  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;

    sendMessage('chat', { message: trimmed });
    setInput('');
    inputRef.current?.focus();
  }, [input, sendMessage]);

  // 回车发送
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // 格式化时间
  const formatChatTime = (ts: number): string => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
      {/* 标题 */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          💬 聊天
        </h3>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
        {chatMessages.length === 0 && (
          <div className="text-center text-gray-400 dark:text-gray-500 text-xs py-8">
            暂无消息，来打个招呼吧 👋
          </div>
        )}

        {chatMessages.map((msg, i) => {
          const isMe = msg.senderId === myId;
          return (
            <div
              key={`${msg.timestamp}-${i}`}
              className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${
                  isMe
                    ? 'bg-primary-500 text-white rounded-br-md'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-bl-md'
                }`}
              >
                {!isMe && (
                  <div className="text-xs text-primary-400 font-medium mb-0.5">
                    {msg.senderName}
                  </div>
                )}
                <div className="break-words">{msg.message}</div>
                <div
                  className={`text-xs mt-1 ${
                    isMe ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {formatChatTime(msg.timestamp)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            maxLength={500}
            className="flex-1 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-800 dark:text-gray-200 placeholder-gray-400"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="px-4 py-2 bg-primary-500 text-white text-sm rounded-full hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
