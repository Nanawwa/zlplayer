import { useState, useRef, useEffect, useCallback } from 'react';
import { useRoomStore } from '../store/roomStore';

interface ChatBoxProps {
  sendMessage: (type: string, payload: Record<string, unknown>) => void;
}

export default function ChatBox({ sendMessage }: ChatBoxProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatMessages = useRoomStore((s) => s.chatMessages);
  const myId = useRoomStore((s) => s.myId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    sendMessage('chat', { message: trimmed });
    setInput('');
    inputRef.current?.focus();
  }, [input, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div
        className="flex-1 overflow-y-auto p-2 min-h-0"
        style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
      >
        {chatMessages.length === 0 && (
          <div className="text-center text-secondary text-xs py-8">
            暂无消息，发一条试试吧
          </div>
        )}

        <div className="space-y-1">
          {chatMessages.map((msg, i) => {
            const isMe = msg.senderId === myId;
            const prev = chatMessages[i - 1];
            // 连续同人消息合并：与上一条同人则不显示昵称 + 减小间距
            const isContinuation =
              prev && prev.senderId === msg.senderId &&
              (msg.timestamp - prev.timestamp) < 60000;

            return (
              <div
                key={`${msg.timestamp}-${i}`}
                className={`flex ${isMe ? 'justify-end' : 'justify-start'} ${isContinuation ? '' : 'mt-2'}`}
              >
                <div className={`max-w-[80%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                  {!isMe && !isContinuation && (
                    <div className="text-xs text-primary-500 font-medium mb-0.5 ml-3">
                      {msg.senderName}
                    </div>
                  )}
                  <div
                    className={`px-3 py-2 text-sm break-words ${
                      isMe
                        ? 'bg-[var(--primary-500)] text-white rounded-[12px] rounded-br-md'
                        : 'bg-elevated text-primary rounded-[12px] rounded-bl-md'
                    }`}
                  >
                    {msg.message}
                  </div>
                  <div
                    className={`text-[10px] text-secondary mt-1 ${
                      isMe ? 'mr-1' : 'ml-3'
                    }`}
                  >
                    {fmtTime(msg.timestamp)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 */}
      <div className="px-2.5 py-2 border-t border-base flex-shrink-0">
        <div className="flex gap-2 items-center">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            maxLength={500}
            className="flex-1 px-4 py-2.5 text-sm bg-elevated text-primary placeholder-[var(--text-secondary)] rounded-[12px] border border-transparent focus:outline-none focus:border-[var(--primary-500)] transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            aria-label="发送"
            className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full bg-[var(--primary-500)] text-white hover:bg-[var(--primary-600)] hover:scale-[1.05] active:scale-95 disabled:opacity-40 disabled:hover:scale-100 transition-all"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
