import type { SyncStatus } from '../utils/syncProtocol';

interface SyncIndicatorProps {
  status: SyncStatus;
  deviation: number;
  /** WebSocket 测量 RTT（秒），0 表示未测量 */
  rtt?: number;
  /** 失去同步时点击重连（可选） */
  onReconnect?: () => void;
}

type DisplayState = 'synced' | 'syncing' | 'desynced';

const CFG: Record<DisplayState, {
  label: string;
  dot: string;
  text: string;
  pulse: boolean;
  blink: boolean;
}> = {
  synced: {
    label: '已同步',
    dot: 'bg-[#22C55E]',
    text: 'text-[#22C55E]',
    pulse: false,
    blink: false,
  },
  syncing: {
    label: '同步中...',
    dot: 'bg-[#EAB308]',
    text: 'text-[#EAB308]',
    pulse: true,
    blink: false,
  },
  desynced: {
    label: '连接断开',
    dot: 'bg-[#EF4444]',
    text: 'text-[#EF4444]',
    pulse: false,
    blink: true,
  },
};

function toDisplay(s: SyncStatus): DisplayState {
  if (s === 'synced') return 'synced';
  if (s === 'desynced') return 'desynced';
  return 'syncing';
}

export default function SyncIndicator({ status, deviation, rtt, onReconnect }: SyncIndicatorProps) {
  const display = toDisplay(status);
  const c = CFG[display];
  const devMs = Number.isFinite(deviation) ? (deviation * 1000).toFixed(0) : '0';
  const rttMs = rtt && rtt > 0 ? Math.round(rtt * 1000) : null;
  const canReconnect = display === 'desynced' && !!onReconnect;

  return (
    <div
      role={canReconnect ? 'button' : 'status'}
      aria-live="polite"
      aria-label={`同步状态: ${c.label}${rttMs ? ', 延迟 ' + rttMs + ' 毫秒' : ''}`}
      onClick={canReconnect ? onReconnect : undefined}
      onKeyDown={canReconnect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onReconnect(); } } : undefined}
      tabIndex={canReconnect ? 0 : undefined}
      title={
        canReconnect
          ? '同步断开，点击尝试重连'
          : `同步: ${c.label} · RTT: ${rttMs ? rttMs + 'ms' : '—'}`
      }
      className={`inline-flex items-center gap-2 text-xs bg-elevated rounded-lg ${
        canReconnect ? 'cursor-pointer hover:bg-card focus:outline-none focus:ring-2 focus:ring-[var(--primary-500)]' : 'cursor-default'
      }`}
      style={{ padding: '8px' }}
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dot} ${
          c.pulse ? 'animate-pulse-soft' : ''
        } ${c.blink ? 'animate-blink' : ''}`}
      />
      <span className={`${c.text} font-medium hidden sm:inline`}>{c.label}</span>
      <span className={`${c.text} font-medium sm:hidden text-[10px]`}>
        {display === 'synced' ? '' : display === 'syncing' ? '...' : '!'}
      </span>
      {rttMs !== null && (
        <span className="text-secondary hidden sm:inline text-[10px]">
          {rttMs}ms
        </span>
      )}
      {Math.abs(deviation) > 0.1 && Number.isFinite(deviation) && (
        <span className="text-secondary hidden sm:inline text-[10px] opacity-60">
          ±{devMs}ms
        </span>
      )}
    </div>
  );
}
