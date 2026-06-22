import type { AnomalyType, AnomalyStatus } from '@shared/types';

const typeConfig: Record<AnomalyType, { label: string; className: string }> = {
  late: { label: '迟到', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  absent: { label: '缺勤', className: 'bg-red-100 text-red-700 border-red-200' },
  duplicate_swipe: { label: '重复刷卡', className: 'bg-purple-100 text-purple-700 border-purple-200' },
  leave_exception: { label: '请假例外', className: 'bg-sky-100 text-sky-700 border-sky-200' },
};

const statusConfig: Record<AnomalyStatus, { label: string; className: string }> = {
  pending: { label: '待处理', className: 'bg-gray-100 text-gray-700 border-gray-200' },
  confirmed: { label: '已确认', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  reverted: { label: '已回退', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  dismissed: { label: '已忽略', className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export function AnomalyTypeBadge({ type }: { type: AnomalyType }) {
  const cfg = typeConfig[type];
  return (
    <span className={`badge border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

export function AnomalyStatusBadge({ status }: { status: AnomalyStatus }) {
  const cfg = statusConfig[status];
  return (
    <span className={`badge border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

export function LeaveTypeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; className: string }> = {
    sick: { label: '病假', className: 'bg-red-50 text-red-600' },
    personal: { label: '事假', className: 'bg-amber-50 text-amber-600' },
    official: { label: '公假', className: 'bg-blue-50 text-blue-600' },
    other: { label: '其他', className: 'bg-gray-50 text-gray-600' },
  };
  const cfg = map[type] || { label: type, className: 'bg-gray-50 text-gray-600' };
  return <span className={`badge ${cfg.className}`}>{cfg.label}</span>;
}
