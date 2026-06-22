import db from './db';
import { recalcDetailRepo, appStateRepo, recalcTaskRepo } from './repositories';
import type { AnomalyFilters, RecalcSummary, DiffChangeType, AnomalyStatus } from '../shared/types';

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function exportAnomaliesCsv(filters: AnomalyFilters = {}): string {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.grade) { conditions.push('s.grade = ?'); params.push(filters.grade); }
  if (filters.class_name) { conditions.push('s.class_name = ?'); params.push(filters.class_name); }
  if (filters.anomaly_type) { conditions.push('a.anomaly_type = ?'); params.push(filters.anomaly_type); }
  if (filters.status) { conditions.push('a.status = ?'); params.push(filters.status); }
  if (filters.start_date) { conditions.push('a.anomaly_date >= ?'); params.push(filters.start_date); }
  if (filters.end_date) { conditions.push('a.anomaly_date <= ?'); params.push(filters.end_date); }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT
      a.id,
      a.anomaly_date,
      s.student_id,
      s.name,
      s.grade,
      s.class_name,
      a.anomaly_type,
      a.description,
      a.status,
      a.review_note,
      a.reviewed_by,
      a.reviewed_at
    FROM anomalies a
    LEFT JOIN students s ON a.student_id = s.student_id
    ${where}
    ORDER BY a.anomaly_date DESC, s.grade, s.class_name, s.name
  `).all(...params) as Array<Record<string, unknown>>;

  const headers = ['异常ID', '日期', '学号', '姓名', '年级', '班级', '异常类型', '异常描述', '处理状态', '处理备注', '复核人', '复核时间'];
  const typeMap: Record<string, string> = {
    late: '迟到',
    absent: '缺勤',
    duplicate_swipe: '重复刷卡',
    leave_exception: '请假例外',
  };
  const statusMap: Record<string, string> = {
    pending: '待处理',
    confirmed: '已确认',
    reverted: '已回退',
    dismissed: '已忽略',
  };

  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      csvEscape(r.id),
      csvEscape(r.anomaly_date),
      csvEscape(r.student_id),
      csvEscape(r.name),
      csvEscape(r.grade),
      csvEscape(r.class_name),
      csvEscape(typeMap[String(r.anomaly_type)] || r.anomaly_type),
      csvEscape(r.description),
      csvEscape(statusMap[String(r.status)] || r.status),
      csvEscape(r.review_note),
      csvEscape(r.reviewed_by),
      csvEscape(r.reviewed_at),
    ].join(','));
  }
  return '\uFEFF' + lines.join('\n');
}

export function exportSummaryCsv(filters: AnomalyFilters = {}): string {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.grade) { conditions.push('s.grade = ?'); params.push(filters.grade); }
  if (filters.class_name) { conditions.push('s.class_name = ?'); params.push(filters.class_name); }
  if (filters.start_date) { conditions.push('a.anomaly_date >= ?'); params.push(filters.start_date); }
  if (filters.end_date) { conditions.push('a.anomaly_date <= ?'); params.push(filters.end_date); }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT
      s.grade,
      s.class_name,
      SUM(CASE WHEN a.anomaly_type = 'late' THEN 1 ELSE 0 END) as late_count,
      SUM(CASE WHEN a.anomaly_type = 'absent' THEN 1 ELSE 0 END) as absent_count,
      SUM(CASE WHEN a.anomaly_type = 'duplicate_swipe' THEN 1 ELSE 0 END) as dup_count,
      SUM(CASE WHEN a.anomaly_type = 'leave_exception' THEN 1 ELSE 0 END) as leave_count,
      COUNT(*) as total
    FROM anomalies a
    LEFT JOIN students s ON a.student_id = s.student_id
    ${where}
    GROUP BY s.grade, s.class_name
    ORDER BY s.grade, s.class_name
  `).all(...params) as Array<Record<string, unknown>>;

  const headers = ['年级', '班级', '迟到', '缺勤', '重复刷卡', '请假例外', '合计'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      csvEscape(r.grade),
      csvEscape(r.class_name),
      csvEscape(r.late_count),
      csvEscape(r.absent_count),
      csvEscape(r.dup_count),
      csvEscape(r.leave_count),
      csvEscape(r.total),
    ].join(','));
  }
  return '\uFEFF' + lines.join('\n');
}

const CHANGE_TYPE_MAP: Record<DiffChangeType, string> = {
  added: '新增',
  removed: '消失',
  kept: '保留',
  kept_modified: '保留(描述变更)',
};

const ANOMALY_TYPE_MAP_EXPORT: Record<string, string> = {
  late: '迟到',
  absent: '缺勤',
  duplicate_swipe: '重复刷卡',
  leave_exception: '请假例外',
};

const ANOMALY_STATUS_MAP_EXPORT: Record<AnomalyStatus, string> = {
  pending: '待处理',
  confirmed: '已确认',
  reverted: '已回退',
  dismissed: '已忽略',
};

export function exportRecalcDiffCsv(taskId: number): string {
  const items = recalcDetailRepo.getAll(taskId);

  const headers = ['变动类型', '日期', '学号', '姓名', '年级', '班级', '异常类型', '原描述', '新描述', '原状态', '新状态'];
  const lines = [headers.join(',')];

  for (const r of items) {
    lines.push([
      csvEscape(CHANGE_TYPE_MAP[r.change_type] || r.change_type),
      csvEscape(r.anomaly_date),
      csvEscape(r.student_id),
      csvEscape(r.student_name),
      csvEscape(r.grade),
      csvEscape(r.class_name),
      csvEscape(ANOMALY_TYPE_MAP_EXPORT[r.anomaly_type] || r.anomaly_type),
      csvEscape(r.old_description),
      csvEscape(r.new_description),
      csvEscape(r.old_status ? ANOMALY_STATUS_MAP_EXPORT[r.old_status] || r.old_status : ''),
      csvEscape(r.new_status ? ANOMALY_STATUS_MAP_EXPORT[r.new_status] || r.new_status : ''),
    ].join(','));
  }
  return '\uFEFF' + lines.join('\n');
}

export function exportRecalcSummaryCsv(taskId: number): string {
  const task = recalcTaskRepo.getById(taskId);
  const stateSummary = appStateRepo.get<RecalcSummary>(`recalc_summary_${taskId}`);

  let summary: RecalcSummary;
  if (stateSummary) {
    summary = stateSummary;
  } else {
    const oldCount = task ? db.prepare(
      "SELECT COUNT(*) as cnt FROM anomalies WHERE anomaly_date >= ? AND anomaly_date <= ?"
    ).get(task.start_date, task.end_date) as { cnt: number } : { cnt: 0 };
    summary = recalcDetailRepo.computeSummary(taskId, oldCount.cnt, 0);
  }

  const lines: string[] = [];

  lines.push('【整体概览】');
  lines.push(['指标', '数量'].join(','));
  lines.push(['重算前异常总数', summary.total_before].join(','));
  lines.push(['重算后异常总数', summary.total_after].join(','));
  lines.push(['新增异常数', summary.added].join(','));
  lines.push(['消失异常数', summary.removed].join(','));
  lines.push(['保留(含变更)', summary.kept + summary.kept_modified].join(','));
  lines.push(['  其中描述/状态变更', summary.kept_modified].join(','));
  lines.push(['  其中完全一致', summary.kept].join(','));
  lines.push('');

  lines.push('【按年级维度】');
  lines.push(['年级', '新增', '消失', '保留'].join(','));
  for (const g of summary.by_grade) {
    lines.push([
      csvEscape(g.grade),
      g.added,
      g.removed,
      g.kept,
    ].join(','));
  }
  lines.push('');

  lines.push('【按班级维度】');
  lines.push(['年级', '班级', '新增', '消失', '保留'].join(','));
  for (const c of summary.by_class) {
    lines.push([
      csvEscape(c.grade),
      csvEscape(c.class_name),
      c.added,
      c.removed,
      c.kept,
    ].join(','));
  }
  lines.push('');

  lines.push('【按异常类型维度】');
  lines.push(['异常类型', '新增', '消失', '保留'].join(','));
  for (const t of summary.by_type) {
    lines.push([
      csvEscape(ANOMALY_TYPE_MAP_EXPORT[t.anomaly_type] || t.anomaly_type),
      t.added,
      t.removed,
      t.kept,
    ].join(','));
  }

  return '\uFEFF' + lines.join('\n');
}
