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
    <div className="lg:hidden fixed inset-0 z-[200] flex flex-col justify-end"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative flex flex-col bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl border border-gray-200 dark:border-gray-700 border-b-0"
        style={{ maxHeight: '85dvh', overscrollBehavior: 'contain' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex-shrink-0 flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h3>
          <button onClick={onClose}
            className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <IconClose size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto"
          style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
