import type { SyncStatus } from '../utils/syncProtocol';

interface SyncIndicatorProps {
  status: SyncStatus;
  deviation: number;
}

const CFG: Record<SyncStatus, { label: string; color: string; bg: string; pulse: boolean }> = {
  idle:       { label: '未连接', color: 'text-gray-400',        bg: 'bg-gray-400',        pulse: false },
  waiting:    { label: '同步中', color: 'text-amber-500',      bg: 'bg-amber-500',       pulse: true },
  synced:     { label: '已同步', color: 'text-green-500',       bg: 'bg-green-500',        pulse: false },
  recovering: { label: '校准中', color: 'text-amber-500',      bg: 'bg-amber-500',       pulse: true },
  desynced:   { label: '不同步', color: 'text-red-500',         bg: 'bg-red-500',          pulse: true },
};

export default function SyncIndicator({ status, deviation }: SyncIndicatorProps) {
  const c = CFG[status];
  const devMs = (deviation * 1000).toFixed(0);

  return (
    <div className="flex items-center gap-1 text-xs" title={`同步: ${c.label} · 偏差: ${devMs}ms`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.bg} ${c.pulse ? 'animate-pulse' : ''}`} />
      <span className={`${c.color} font-medium hidden sm:inline`}>{c.label}</span>
      <span className={`${c.color} font-medium sm:hidden text-[10px]`}>
        {status === 'synced' ? '' : status === 'waiting' ? '...' : '!'}
      </span>
      {Math.abs(deviation) > 0.1 && (
        <span className="text-gray-400 hidden sm:inline text-[10px]">{devMs}ms</span>
      )}
    </div>
  );
}
