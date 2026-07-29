import { useEffect } from 'react';
import { IconClose } from './Icons';

interface MobilePanelProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function MobilePanel({ title, onClose, children }: MobilePanelProps) {
  useEffect(() => {
    const prev = {
      overflow: document.body.style.overflow,
      touchAction: document.body.style.touchAction,
      overscrollBehavior: document.body.style.overscrollBehavior,
    };
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    document.body.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = prev.overflow;
      document.body.style.touchAction = prev.touchAction;
      document.body.style.overscrollBehavior = prev.overscrollBehavior;
    };
  }, []);

  return (
    <div
      className="lg:hidden fixed inset-0 z-[200] flex flex-col justify-end"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" />

      {/* 底部弹出面板 */}
      <div
        className="relative flex flex-col bg-card rounded-t-[16px] shadow-modal border border-base border-b-0 animate-slide-up"
        style={{ maxHeight: '85dvh', overscrollBehavior: 'contain' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部拖拽手柄 */}
        <div className="flex-shrink-0 flex justify-center pt-2.5 pb-1">
          <div className="w-10 h-1 rounded-full bg-[var(--border-color)]" />
        </div>

        {/* 标题栏 */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2">
          <h3 className="font-display text-sm font-semibold text-primary">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-elevated text-secondary hover:text-primary transition-colors"
            aria-label="关闭"
          >
            <IconClose size={18} />
          </button>
        </div>

        {/* 内容区 */}
        <div
          className="flex-1 min-h-0 overflow-y-auto px-4 pb-4"
          style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
