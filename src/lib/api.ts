import type {
  Student,
  SwipeRecord,
  LeaveRecord,
  Anomaly,
  ReviewHistory,
  GradeRule,
  RuleVersion,
  ImportError,
  AnomalyFilters,
  PagedResult,
  TrendDataPoint,
  DistributionDataPoint,
  RecalcTask,
  RecalcTaskDetail,
  RecalcSummary,
  RecalcDetailItem,
  DiffChangeType,
  RuleVersionDiff,
  OperationLog,
  AnomalyType,
} from '@shared/types';

const BASE = '/api';

async function handleRes<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/csv')) return (await res.text()) as unknown as T;
  return res.json();
}

function qs(params: Record<string, unknown>): string {
  const parts: string[] = [];
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  });
  return parts.length ? '?' + parts.join('&') : '';
}

const $h = handleRes as unknown as (res: Response) => Promise<any>;

export const api = {
  students: {
    list(): Promise<Student[]> {
      return fetch(`${BASE}/students`).then($h);
    },
    grades(): Promise<string[]> {
      return fetch(`${BASE}/students/grades`).then($h);
    },
    classes(grade?: string): Promise<{ grade: string; class_name: string }[]> {
      return fetch(`${BASE}/students/classes${qs({ grade })}`).then($h);
    },
    import(rows: Partial<Student>[]): Promise<{ imported: number }> {
      return fetch(`${BASE}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      }).then($h);
    },
  },
  import: {
    validateSwipes(rows: Record<string, unknown>[]): Promise<{
      valid_records: number;
      errors: ImportError[];
      students_found: string[];
    }> {
      return fetch(`${BASE}/import/validate/swipes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      }).then($h);
    },
    validateLeaves(rows: Record<string, unknown>[]): Promise<{
      valid_records: number;
      errors: ImportError[];
      students_found: string[];
    }> {
      return fetch(`${BASE}/import/validate/leaves`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      }).then($h);
    },
    commitSwipes(rows: Record<string, unknown>[]): Promise<{
      imported: number;
      errors: ImportError[];
      batch_id: string;
      anomalies_detected: number;
      date_range: { start: string; end: string } | null;
    }> {
      return fetch(`${BASE}/import/commit/swipes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      }).then($h);
    },
    commitLeaves(rows: Record<string, unknown>[]): Promise<{
      imported: number;
      errors: ImportError[];
      anomalies_detected: number;
      date_range: { start: string; end: string } | null;
    }> {
      return fetch(`${BASE}/import/commit/leaves`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      }).then($h);
    },
    sample(): Promise<{
      students: number;
      swipeRecords: number;
      leaveRecords: number;
      anomalies: number;
      dateRange: { start: string; end: string } | null;
    }> {
      return fetch(`${BASE}/import/sample`, { method: 'POST' }).then($h);
    },
  },
  anomalies: {
    list(filters: AnomalyFilters = {}): Promise<PagedResult<Anomaly & { student?: Student }>> {
      return fetch(`${BASE}/anomalies${qs(filters as Record<string, unknown>)}`).then($h);
    },
    counts(): Promise<Record<string, number>> {
      return fetch(`${BASE}/anomalies/counts`).then($h);
    },
    detail(id: number): Promise<{
      anomaly: Anomaly & { student?: Student };
      swipes: SwipeRecord[];
      leaves: LeaveRecord[];
      history: ReviewHistory[];
    }> {
      return fetch(`${BASE}/anomalies/${id}`).then($h);
    },
    review(id: number, payload: { note?: string; action?: string; operator?: string }): Promise<{ id: number; status: string }> {
      return fetch(`${BASE}/anomalies/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then($h);
    },
    revert(id: number, payload: { note?: string; operator?: string }): Promise<{ id: number; status: string }> {
      return fetch(`${BASE}/anomalies/${id}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then($h);
    },
    redetect(params?: { start_date?: string; end_date?: string }): Promise<{ total: number; start_date?: string; end_date?: string; date_range?: { start: string; end: string } | null }> {
      return fetch(`${BASE}/anomalies/redetect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {}),
      }).then($h);
    },
  },
  rules: {
    list(): Promise<GradeRule[]> {
      return fetch(`${BASE}/rules`).then($h);
    },
    save(rules: GradeRule[], description?: string): Promise<{ saved: number }> {
      return fetch(`${BASE}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(description ? [...rules, { __description: description }] : rules),
      }).then($h);
    },
    versions(): Promise<RuleVersion[]> {
      return fetch(`${BASE}/rules/versions`).then($h);
    },
    rollback(id: number): Promise<{ rolled_back: boolean; version_id: number; rules: GradeRule[] }> {
      return fetch(`${BASE}/rules/versions/${id}/rollback`, {
        method: 'POST',
      }).then($h);
    },
    compare(opts?: { old_id?: number | 'current' | string; new_id?: number | 'current' | string }): Promise<RuleVersionDiff> {
      return fetch(`${BASE}/rules/compare${qs(opts as Record<string, unknown>)}`).then($h);
    },
    dryRun(payload: { rules: GradeRule[]; description?: string }): Promise<RuleVersionDiff> {
      const body = payload.description ? [...payload.rules, { __description: payload.description }] : payload.rules;
      return fetch(`${BASE}/rules/save-dry-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then($h);
    },
  },
  recalc: {
    lockStatus(): Promise<{ ok: boolean; blocking_task?: RecalcTask; running?: RecalcTask[] }> {
      return fetch(`${BASE}/recalc/lock-status`).then($h);
    },
    createTask(payload: {
      rule_version_id?: number;
      start_date: string;
      end_date: string;
      operator?: string;
      rules_override?: GradeRule[];
    }): Promise<{ task_id: number }> {
      return fetch(`${BASE}/recalc/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then($h);
    },
    listTasks(): Promise<RecalcTask[]> {
      return fetch(`${BASE}/recalc/tasks`).then($h);
    },
    getTask(id: number): Promise<RecalcTaskDetail> {
      return fetch(`${BASE}/recalc/tasks/${id}`).then($h);
    },
    getSummary(id: number): Promise<RecalcSummary> {
      return fetch(`${BASE}/recalc/tasks/${id}/summary`).then($h);
    },
    getDetails(id: number, opts?: {
      change_type?: DiffChangeType;
      anomaly_type?: AnomalyType;
      grade?: string;
      class_name?: string;
      page?: number;
      page_size?: number;
    }): Promise<PagedResult<RecalcDetailItem>> {
      return fetch(`${BASE}/recalc/tasks/${id}/details${qs(opts as Record<string, unknown>)}`).then($h);
    },
    cancelTask(id: number): Promise<void> {
      return fetch(`${BASE}/recalc/tasks/${id}/cancel`, {
        method: 'POST',
      }).then($h);
    },
    logs(): Promise<OperationLog[]> {
      return fetch(`${BASE}/recalc/logs`).then($h);
    },
  },
  export: {
    anomalies(filters: AnomalyFilters = {}): Promise<string> {
      return fetch(`${BASE}/export/anomalies${qs(filters as Record<string, unknown>)}`).then($h);
    },
    summary(filters: AnomalyFilters = {}): Promise<string> {
      return fetch(`${BASE}/export/summary${qs(filters as Record<string, unknown>)}`).then($h);
    },
    recalcDiff(taskId: number): Promise<string> {
      return fetch(`${BASE}/export/recalc/${taskId}/diff`).then($h);
    },
    recalcSummary(taskId: number): Promise<string> {
      return fetch(`${BASE}/export/recalc/${taskId}/summary`).then($h);
    },
  },
  statistics: {
    trend(params?: { grade?: string; class_name?: string }): Promise<TrendDataPoint[]> {
      return fetch(`${BASE}/statistics/trend${qs(params || {})}`).then($h);
    },
    distribution(params?: { grade?: string; start_date?: string; end_date?: string }): Promise<DistributionDataPoint[]> {
      return fetch(`${BASE}/statistics/distribution${qs(params || {})}`).then($h);
    },
    getState<T = unknown>(key: string): Promise<{ value: T | null }> {
      return fetch(`${BASE}/statistics/state/${encodeURIComponent(key)}`).then($h);
    },
    saveState(key: string, value: unknown): Promise<{ saved: boolean }> {
      return fetch(`${BASE}/statistics/state/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      }).then($h);
    },
  },
};

export function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

export function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h.trim()] = values[i] ?? '';
    });
    return obj;
  });
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
