import type { SyncStatus } from '../utils/syncProtocol';

interface SyncIndicatorProps {
  status: SyncStatus;
  deviation: number;
}

const STATUS_CONFIG: Record<SyncStatus, { label: string; color: string; bg: string }> = {
  idle:     { label: '未连接', color: 'text-gray-400',        bg: 'bg-gray-400' },
  waiting:  { label: '同步中…', color: 'text-amber-500',      bg: 'bg-amber-500' },
  synced:   { label: '已同步',  color: 'text-green-500',       bg: 'bg-green-500' },
  recovering: { label: '校准中…', color: 'text-amber-500',    bg: 'bg-amber-500' },
  desynced: { label: '不同步',  color: 'text-red-500',         bg: 'bg-red-500' },
};

export default function SyncIndicator({ status, deviation }: SyncIndicatorProps) {
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="flex items-center gap-1.5 text-xs" title={`偏差: ${(deviation * 1000).toFixed(0)}ms`}>
      <span className={`w-2 h-2 rounded-full ${cfg.bg} ${status === 'recovering' ? 'animate-pulse' : ''} ${status === 'synced' ? '' : ''}`} />
      <span className={`${cfg.color} font-medium hidden sm:inline`}>{cfg.label}</span>
      {status === 'synced' && Math.abs(deviation) > 0.05 && (
        <span className="text-gray-400 hidden sm:inline">
          ({(deviation * 1000).toFixed(0)}ms)
        </span>
      )}
    </div>
  );
}
