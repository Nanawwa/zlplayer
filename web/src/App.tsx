import { useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useRoomStore } from './store/roomStore';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';

/**
 * 应用根组件
 * 桥接 WebSocket 消息到同步引擎
 */
export default function App() {
  const syncHandlerRef = useRef<((cmd: any) => void) | undefined>(undefined);
  const { sendMessage } = useWebSocket((cmd) => syncHandlerRef.current?.(cmd));
  const currentPage = useRoomStore((s) => s.currentPage);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {currentPage === 'home' && <HomePage sendMessage={sendMessage} />}
      {currentPage === 'room' && (
        <RoomPage sendMessage={sendMessage} syncHandlerRef={syncHandlerRef} />
      )}
    </div>
  );
}
