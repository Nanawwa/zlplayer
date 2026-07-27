import { useRoomStore } from '../store/roomStore';

/**
 * 房间成员列表组件
 */
export default function RoomList() {
  const members = useRoomStore((s) => s.members);
  const ownerId = useRoomStore((s) => s.ownerId);
  const myId = useRoomStore((s) => s.myId);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
      {/* 标题 */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          👥 成员 ({members.length})
        </h3>
      </div>

      {/* 成员列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1 min-h-0">
        {members.map((member) => {
          const isOwner = member.id === ownerId;
          const isMe = member.id === myId;

          return (
            <div
              key={member.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                isMe ? 'bg-primary-50 dark:bg-primary-900/20' : ''
              }`}
            >
              {/* 头像 */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                isOwner ? 'bg-amber-500' : 'bg-primary-500'
              }`}>
                {member.name.charAt(0).toUpperCase()}
              </div>

              {/* 信息 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate text-gray-800 dark:text-gray-200">
                    {member.name}
                  </span>
                  {isMe && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">(我)</span>
                  )}
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-2">
                  {isOwner && (
                    <span className="text-amber-500 font-medium">👑 房主</span>
                  )}
                  {!isOwner && !isMe && (
                    <span>成员</span>
                  )}
                </div>
              </div>

              {/* 状态指示 */}
              <div className="w-2 h-2 rounded-full bg-green-500" title="在线" />
            </div>
          );
        })}

        {members.length === 0 && (
          <div className="text-center text-gray-400 dark:text-gray-500 text-xs py-8">
            等待成员加入...
          </div>
        )}
      </div>
    </div>
  );
}
