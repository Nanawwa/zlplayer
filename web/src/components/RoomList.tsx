import { useCallback } from 'react';
import { useRoomStore } from '../store/roomStore';
import { IconCrown } from './Icons';

interface RoomListProps {
  sendMessage?: (type: string, payload: Record<string, unknown>) => void;
}

export default function RoomList({ sendMessage }: RoomListProps) {
  const members = useRoomStore((s) => s.members);
  const ownerId = useRoomStore((s) => s.ownerId);
  const myId = useRoomStore((s) => s.myId);
  const isOwner = useRoomStore((s) => s.isOwner);

  const handleKick = useCallback((memberId: string) => {
    if (!sendMessage) return;
    if (!confirm('确定踢出该成员？')) return;
    sendMessage('kick_member', { memberId });
  }, [sendMessage]);

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex-1 overflow-y-auto p-1 space-y-1 min-h-0"
        style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
      >
        {members.length === 0 ? (
          <div className="text-center text-secondary text-xs py-8">
            等待成员加入
          </div>
        ) : (
          members.map((member) => {
            const isMemberOwner = member.id === ownerId;
            const isMe = member.id === myId;
            const canKick = isOwner && !isMe && !!sendMessage;
            return (
              <div
                key={member.id}
                className={`flex items-center gap-3 px-2.5 py-2 rounded-lg transition-colors ${
                  isMe ? 'bg-[var(--primary-500)]/10' : 'hover:bg-elevated'
                }`}
              >
                <div className="relative flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-[var(--primary-500)]/20 text-[var(--primary-500)] flex items-center justify-center text-xs font-bold font-display">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#22C55E] border-2 border-card" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate text-primary font-display">
                      {member.name}
                    </span>
                    {isMe && <span className="text-[10px] text-secondary flex-shrink-0">我</span>}
                    {isMemberOwner && <IconCrown size={12} className="text-[#F59E0B] flex-shrink-0" />}
                  </div>
                </div>

                {canKick && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleKick(member.id); }}
                    className="flex-shrink-0 px-2 py-0.5 text-[10px] font-medium text-[#EF4444] hover:bg-[#EF4444]/10 rounded-md transition-colors"
                    aria-label={`踢出 ${member.name}`}
                  >
                    踢出
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
