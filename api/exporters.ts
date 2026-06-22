import db from './db';
import type { AnomalyFilters } from '../shared/types';

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
