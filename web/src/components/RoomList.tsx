import { useRoomStore } from '../store/roomStore';
import { IconCrown } from './Icons';

export default function RoomList() {
  const members = useRoomStore((s) => s.members);
  const ownerId = useRoomStore((s) => s.ownerId);
  const myId = useRoomStore((s) => s.myId);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-1 space-y-0.5 min-h-0"
        style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
        {members.length === 0 ? (
          <div className="text-center text-gray-400 dark:text-gray-500 text-xs py-8">
            等待成员加入
          </div>
        ) : (
          members.map((member) => {
            const isOwner = member.id === ownerId;
            const isMe = member.id === myId;
            return (
              <div key={member.id}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg ${isMe ? 'bg-blue-50 dark:bg-blue-900/10' : ''}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0
                  ${isOwner ? 'bg-amber-500' : 'bg-blue-500'}`}>
                  {member.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate text-gray-800 dark:text-gray-200">
                      {member.name}
                    </span>
                    {isMe && <span className="text-[10px] text-gray-400 flex-shrink-0">我</span>}
                    {isOwner && <IconCrown size={11} className="text-amber-500 flex-shrink-0" />}
                  </div>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
