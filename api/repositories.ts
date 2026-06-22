import db from './db';
import type {
  Student,
  SwipeRecord,
  LeaveRecord,
  Anomaly,
  ReviewHistory,
  GradeRule,
  RuleVersion,
  RuleVersionDiff,
  GradeRuleDiff,
  RuleFieldDiff,
  RuleFieldKey,
  AnomalyFilters,
  PagedResult,
  RecalcTask,
  RecalcTaskStatus,
  RecalcDetailItem,
  DiffChangeType,
  OperationLog,
  RecalcSummary,
} from '../shared/types';

export const studentRepo = {
  getAll(): Student[] {
    return db.prepare('SELECT * FROM students ORDER BY grade, class_name, name').all() as Student[];
  },

  getById(id: string): Student | undefined {
    return db.prepare('SELECT * FROM students WHERE student_id = ?').get(id) as Student | undefined;
  },

  upsert(student: Student): void {
    db.prepare(`
      INSERT INTO students (student_id, name, grade, class_name)
      VALUES (@student_id, @name, @grade, @class_name)
      ON CONFLICT(student_id) DO UPDATE SET
        name = excluded.name,
        grade = excluded.grade,
        class_name = excluded.class_name
    `).run(student);
  },

  bulkUpsert(students: Student[]): void {
    const stmt = db.prepare(`
      INSERT INTO students (student_id, name, grade, class_name)
      VALUES (@student_id, @name, @grade, @class_name)
      ON CONFLICT(student_id) DO UPDATE SET
        name = excluded.name,
        grade = excluded.grade,
        class_name = excluded.class_name
    `);
    const tx = db.transaction((list: Student[]) => {
      for (const s of list) stmt.run(s);
    });
    tx(students);
  },

  getGrades(): string[] {
    const rows = db.prepare('SELECT DISTINCT grade FROM students ORDER BY grade').all() as { grade: string }[];
    return rows.map(r => r.grade);
  },

  getClasses(grade?: string): { grade: string; class_name: string }[] {
    let sql = 'SELECT DISTINCT grade, class_name FROM students';
    const params: string[] = [];
    if (grade) {
      sql += ' WHERE grade = ?';
      params.push(grade);
    }
    sql += ' ORDER BY grade, class_name';
    return db.prepare(sql).all(...params) as { grade: string; class_name: string }[];
  },
};

export const swipeRepo = {
  insert(record: SwipeRecord): number {
    const info = db.prepare(`
      INSERT INTO swipe_records (student_id, swipe_time, device_location, import_batch_id)
      VALUES (@student_id, @swipe_time, @device_location, @import_batch_id)
    `).run({
      ...record,
      device_location: record.device_location ?? null,
      import_batch_id: record.import_batch_id ?? null,
    });
    return Number(info.lastInsertRowid);
  },

  bulkInsert(records: SwipeRecord[]): void {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO swipe_records (student_id, swipe_time, device_location, import_batch_id)
      VALUES (@student_id, @swipe_time, @device_location, @import_batch_id)
    `);
    const tx = db.transaction((list: SwipeRecord[]) => {
      for (const r of list) {
        stmt.run({
          ...r,
          device_location: r.device_location ?? null,
          import_batch_id: r.import_batch_id ?? null,
        });
      }
    });
    tx(records);
  },

  existsDuplicate(studentId: string, swipeTime: string): boolean {
    const row = db.prepare(
      'SELECT COUNT(*) as cnt FROM swipe_records WHERE student_id = ? AND swipe_time = ?'
    ).get(studentId, swipeTime) as { cnt: number };
    return row.cnt > 0;
  },

  getByStudentAndDate(studentId: string, date: string): SwipeRecord[] {
    return db.prepare(`
      SELECT * FROM swipe_records
      WHERE student_id = ? AND DATE(swipe_time) = ?
      ORDER BY swipe_time
    `).all(studentId, date) as SwipeRecord[];
  },

  clearAll(): void {
    db.prepare('DELETE FROM swipe_records').run();
  },
};

export const leaveRepo = {
  insert(record: LeaveRecord): number {
    const info = db.prepare(`
      INSERT INTO leave_records (student_id, leave_type, start_time, end_time, reason)
      VALUES (@student_id, @leave_type, @start_time, @end_time, @reason)
    `).run(record);
    return Number(info.lastInsertRowid);
  },

  bulkInsert(records: LeaveRecord[]): void {
    const stmt = db.prepare(`
      INSERT INTO leave_records (student_id, leave_type, start_time, end_time, reason)
      VALUES (@student_id, @leave_type, @start_time, @end_time, @reason)
    `);
    const tx = db.transaction((list: LeaveRecord[]) => {
      for (const r of list) stmt.run(r);
    });
    tx(records);
  },

  getByStudentAndDate(studentId: string, date: string): LeaveRecord[] {
    return db.prepare(`
      SELECT * FROM leave_records
      WHERE student_id = ? AND DATE(start_time) <= ? AND DATE(end_time) >= ?
      ORDER BY start_time
    `).all(studentId, date, date) as LeaveRecord[];
  },

  clearAll(): void {
    db.prepare('DELETE FROM leave_records').run();
  },
};

export const anomalyRepo = {
  insert(a: Omit<Anomaly, 'id' | 'created_at'>): number {
    const info = db.prepare(`
      INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status)
      VALUES (@student_id, @anomaly_type, @anomaly_date, @description, @status)
    `).run(a);
    return Number(info.lastInsertRowid);
  },

  bulkInsert(anomalies: Array<Omit<Anomaly, 'id' | 'created_at'>>): void {
    const stmt = db.prepare(`
      INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status)
      VALUES (@student_id, @anomaly_type, @anomaly_date, @description, @status)
    `);
    const tx = db.transaction((list: Array<Omit<Anomaly, 'id' | 'created_at'>>) => {
      for (const a of list) stmt.run(a);
    });
    tx(anomalies);
  },

  getById(id: number): (Anomaly & { student?: Student }) | undefined {
    const row = db.prepare(`
      SELECT a.*, s.name as student_name, s.grade, s.class_name
      FROM anomalies a
      LEFT JOIN students s ON a.student_id = s.student_id
      WHERE a.id = ?
    `).get(id) as (Anomaly & { student_name?: string; grade?: string; class_name?: string }) | undefined;
    if (!row) return undefined;
    const { student_name, grade, class_name, ...rest } = row;
    return {
      ...rest,
      student: student_name ? { student_id: row.student_id, name: student_name, grade: grade!, class_name: class_name! } : undefined,
    };
  },

  query(filters: AnomalyFilters): PagedResult<Anomaly & { student?: Student }> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters.grade) {
      conditions.push('s.grade = ?');
      params.push(filters.grade);
    }
    if (filters.class_name) {
      conditions.push('s.class_name = ?');
      params.push(filters.class_name);
    }
    if (filters.anomaly_type) {
      conditions.push('a.anomaly_type = ?');
      params.push(filters.anomaly_type);
    }
    if (filters.status) {
      conditions.push('a.status = ?');
      params.push(filters.status);
    }
    if (filters.start_date) {
      conditions.push('a.anomaly_date >= ?');
      params.push(filters.start_date);
    }
    if (filters.end_date) {
      conditions.push('a.anomaly_date <= ?');
      params.push(filters.end_date);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRow = db.prepare(`
      SELECT COUNT(*) as cnt
      FROM anomalies a
      LEFT JOIN students s ON a.student_id = s.student_id
      ${where}
    `).get(...params) as { cnt: number };

    const page = filters.page || 1;
    const pageSize = filters.page_size || 20;
    const offset = (page - 1) * pageSize;

    const rows = db.prepare(`
      SELECT a.*, s.name as student_name, s.grade, s.class_name
      FROM anomalies a
      LEFT JOIN students s ON a.student_id = s.student_id
      ${where}
      ORDER BY a.anomaly_date DESC, a.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset) as (Anomaly & { student_name?: string; grade?: string; class_name?: string })[];

    const data = rows.map(row => {
      const { student_name, grade, class_name, ...rest } = row;
      return {
        ...rest,
        student: student_name ? { student_id: row.student_id, name: student_name, grade: grade!, class_name: class_name! } : undefined,
      };
    });

    return {
      data,
      total: countRow.cnt,
      page,
      page_size: pageSize,
    };
  },

  updateStatus(id: number, status: string, note?: string, reviewedBy?: string): void {
    db.prepare(`
      UPDATE anomalies
      SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, note || null, reviewedBy || null, id);
  },

  restoreStatus(id: number, status: string, note: string | null, reviewedBy: string | null, reviewedAt: string | null): void {
    db.prepare(`
      UPDATE anomalies
      SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?
      WHERE id = ?
    `).run(status, note, reviewedBy, reviewedAt, id);
  },

  clearAll(): void {
    db.prepare('DELETE FROM review_histories').run();
    db.prepare('DELETE FROM anomalies').run();
  },

  clearPending(): void {
    db.prepare('DELETE FROM review_histories WHERE anomaly_id IN (SELECT id FROM anomalies WHERE status = ?)').run('pending');
    db.prepare('DELETE FROM anomalies WHERE status = ?').run('pending');
  },

  getReviewed(): Anomaly[] {
    return db.prepare("SELECT * FROM anomalies WHERE status != 'pending'").all() as Anomaly[];
  },

  getReviewedKeys(): Set<string> {
    const rows = db.prepare("SELECT student_id, anomaly_type, anomaly_date FROM anomalies WHERE status != 'pending'").all() as { student_id: string; anomaly_type: string; anomaly_date: string }[];
    return new Set(rows.map(r => `${r.student_id}__${r.anomaly_type}__${r.anomaly_date}`));
  },

  getCountsByStatus(): Record<string, number> {
    const rows = db.prepare('SELECT status, COUNT(*) as cnt FROM anomalies GROUP BY status').all() as { status: string; cnt: number }[];
    const result: Record<string, number> = { pending: 0, confirmed: 0, reverted: 0, dismissed: 0 };
    for (const r of rows) result[r.status] = r.cnt;
    return result;
  },
};

export const reviewHistoryRepo = {
  insert(h: Omit<ReviewHistory, 'id' | 'created_at'>): number {
    const info = db.prepare(`
      INSERT INTO review_histories (anomaly_id, action, old_status, new_status, note, operator)
      VALUES (@anomaly_id, @action, @old_status, @new_status, @note, @operator)
    `).run(h);
    return Number(info.lastInsertRowid);
  },

  getByAnomalyId(anomalyId: number): ReviewHistory[] {
    return db.prepare(`
      SELECT * FROM review_histories
      WHERE anomaly_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(anomalyId) as ReviewHistory[];
  },
};

export const gradeRuleRepo = {
  getAll(): GradeRule[] {
    return db.prepare('SELECT * FROM grade_rules ORDER BY grade').all() as GradeRule[];
  },

  getByGrade(grade: string): GradeRule | undefined {
    return db.prepare('SELECT * FROM grade_rules WHERE grade = ?').get(grade) as GradeRule | undefined;
  },

  upsert(rule: GradeRule): void {
    db.prepare(`
      INSERT INTO grade_rules (grade, morning_start_time, late_tolerance_minutes, afternoon_start_time, absent_window_minutes)
      VALUES (@grade, @morning_start_time, @late_tolerance_minutes, @afternoon_start_time, @absent_window_minutes)
      ON CONFLICT(grade) DO UPDATE SET
        morning_start_time = excluded.morning_start_time,
        late_tolerance_minutes = excluded.late_tolerance_minutes,
        afternoon_start_time = excluded.afternoon_start_time,
        absent_window_minutes = excluded.absent_window_minutes,
        updated_at = CURRENT_TIMESTAMP
    `).run(rule);
  },

  saveAll(rules: GradeRule[]): void {
    const tx = db.transaction((list: GradeRule[]) => {
      for (const r of list) {
        db.prepare(`
          INSERT INTO grade_rules (grade, morning_start_time, late_tolerance_minutes, afternoon_start_time, absent_window_minutes)
          VALUES (@grade, @morning_start_time, @late_tolerance_minutes, @afternoon_start_time, @absent_window_minutes)
          ON CONFLICT(grade) DO UPDATE SET
            morning_start_time = excluded.morning_start_time,
            late_tolerance_minutes = excluded.late_tolerance_minutes,
            afternoon_start_time = excluded.afternoon_start_time,
            absent_window_minutes = excluded.absent_window_minutes,
            updated_at = CURRENT_TIMESTAMP
        `).run(r);
      }
    });
    tx(rules);
  },

  clearAll(): void {
    db.prepare('DELETE FROM grade_rules').run();
  },
};

export const ruleVersionRepo = {
  create(content: GradeRule[], description?: string): number {
    const info = db.prepare(`
      INSERT INTO rule_versions (content, description)
      VALUES (?, ?)
    `).run(JSON.stringify(content), description || null);
    return Number(info.lastInsertRowid);
  },

  getAll(): RuleVersion[] {
    const rows = db.prepare('SELECT * FROM rule_versions ORDER BY created_at DESC').all() as { id: number; content: string; description?: string; created_at: string }[];
    return rows.map(r => ({
      id: r.id,
      content: JSON.parse(r.content),
      description: r.description,
      created_at: r.created_at,
    }));
  },

  getById(id: number): RuleVersion | undefined {
    const row = db.prepare('SELECT * FROM rule_versions WHERE id = ?').get(id) as { id: number; content: string; description?: string; created_at: string } | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      content: JSON.parse(row.content),
      description: row.description,
      created_at: row.created_at,
    };
  },
};

export const appStateRepo = {
  get<T = unknown>(key: string): T | undefined {
    const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return undefined;
    return JSON.parse(row.value) as T;
  },

  set(key: string, value: unknown): void {
    db.prepare(`
      INSERT INTO app_state (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `).run(key, JSON.stringify(value));
  },
};

const RULE_FIELDS: Array<{ key: RuleFieldKey; label: string }> = [
  { key: 'morning_start_time', label: '上午上课时间' },
  { key: 'late_tolerance_minutes', label: '迟到宽容(分钟)' },
  { key: 'afternoon_start_time', label: '下午上课时间' },
  { key: 'absent_window_minutes', label: '缺勤判定窗口(分钟)' },
];

function getFieldValue(rule: GradeRule | undefined, field: RuleFieldKey): string | number | null {
  if (!rule) return null;
  const v = rule[field];
  return v === undefined || v === null ? null : v;
}

export function computeRuleDiff(
  oldRules: GradeRule[],
  newRules: GradeRule[],
  opts: { old_version_id?: number | null; new_version_id?: number | null; old_description?: string; new_description?: string } = {},
): RuleVersionDiff {
  const oldMap = new Map(oldRules.map(r => [r.grade, r]));
  const newMap = new Map(newRules.map(r => [r.grade, r]));
  const allGrades = Array.from(new Set([...oldMap.keys(), ...newMap.keys()])).sort();

  const grades: GradeRuleDiff[] = [];
  let added = 0, removed = 0, modified = 0, unchanged = 0;

  for (const grade of allGrades) {
    const oldRule = oldMap.get(grade);
    const newRule = newMap.get(grade);
    const existsInOld = !!oldRule;
    const existsInNew = !!newRule;

    const fields: RuleFieldDiff[] = RULE_FIELDS.map(f => {
      const ov = getFieldValue(oldRule, f.key);
      const nv = getFieldValue(newRule, f.key);
      return {
        field: f.key,
        field_label: f.label,
        old_value: ov,
        new_value: nv,
        changed: String(ov) !== String(nv),
      };
    });

    let status: GradeRuleDiff['status'];
    if (!existsInOld && existsInNew) { status = 'added'; added++; }
    else if (existsInOld && !existsInNew) { status = 'removed'; removed++; }
    else if (fields.some(f => f.changed)) { status = 'modified'; modified++; }
    else { status = 'unchanged'; unchanged++; }

    grades.push({ grade, exists_in_old: existsInOld, exists_in_new: existsInNew, status, fields });
  }

  return {
    old_version_id: opts.old_version_id ?? null,
    new_version_id: opts.new_version_id ?? null,
    old_description: opts.old_description,
    new_description: opts.new_description,
    summary: { total_grades: allGrades.length, added, removed, modified, unchanged },
    grades,
  };
}

export const recalcTaskRepo = {
  create(params: {
    rule_version_id?: number | null;
    rule_snapshot: GradeRule[];
    start_date: string;
    end_date: string;
    operator?: string;
  }): number {
    const info = db.prepare(`
      INSERT INTO recalc_tasks (rule_version_id, rule_snapshot, start_date, end_date, operator, status, progress_percent)
      VALUES (?, ?, ?, ?, ?, 'queued', 0)
    `).run(
      params.rule_version_id ?? null,
      JSON.stringify(params.rule_snapshot),
      params.start_date,
      params.end_date,
      params.operator || '管理员',
    );
    return Number(info.lastInsertRowid);
  },

  getById(id: number): RecalcTask | undefined {
    const row = db.prepare('SELECT * FROM recalc_tasks WHERE id = ?').get(id) as (Omit<RecalcTask, 'rule_snapshot'> & { rule_snapshot: string }) | undefined;
    if (!row) return undefined;
    return { ...row, rule_snapshot: JSON.parse(row.rule_snapshot) } as RecalcTask;
  },

  list(limit = 50): RecalcTask[] {
    const rows = db.prepare('SELECT * FROM recalc_tasks ORDER BY created_at DESC LIMIT ?').all(limit) as Array<Omit<RecalcTask, 'rule_snapshot'> & { rule_snapshot: string }>;
    return rows.map(r => ({ ...r, rule_snapshot: JSON.parse(r.rule_snapshot) } as RecalcTask));
  },

  getRunningOrQueued(): RecalcTask[] {
    const rows = db.prepare("SELECT * FROM recalc_tasks WHERE status IN ('queued','running') ORDER BY created_at ASC").all() as Array<Omit<RecalcTask, 'rule_snapshot'> & { rule_snapshot: string }>;
    return rows.map(r => ({ ...r, rule_snapshot: JSON.parse(r.rule_snapshot) } as RecalcTask));
  },

  updateStatus(id: number, status: RecalcTaskStatus, extra: Partial<Pick<RecalcTask, 'error_message' | 'progress_percent' | 'progress_message'>> = {}): void {
    const fields: string[] = ['status = ?'];
    const params: (string | number | null)[] = [status];

    if (status === 'running' && !extra.progress_percent) {
      fields.push('started_at = CURRENT_TIMESTAMP');
    }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      fields.push('finished_at = CURRENT_TIMESTAMP');
    }
    if (extra.error_message !== undefined) { fields.push('error_message = ?'); params.push(extra.error_message); }
    if (extra.progress_percent !== undefined) { fields.push('progress_percent = ?'); params.push(extra.progress_percent); }
    if (extra.progress_message !== undefined) { fields.push('progress_message = ?'); params.push(extra.progress_message); }

    params.push(id);
    db.prepare(`UPDATE recalc_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  },

  clearAll(): void {
    db.prepare('DELETE FROM recalc_details').run();
    db.prepare('DELETE FROM recalc_tasks').run();
  },
};

export const recalcDetailRepo = {
  bulkInsert(items: Array<Omit<RecalcDetailItem, 'id' | 'created_at'>>): void {
    if (items.length === 0) return;
    const stmt = db.prepare(`
      INSERT INTO recalc_details (task_id, change_type, student_id, student_name, grade, class_name, anomaly_type, anomaly_date, old_description, new_description, old_status, new_status, old_anomaly_id, new_anomaly_id)
      VALUES (@task_id, @change_type, @student_id, @student_name, @grade, @class_name, @anomaly_type, @anomaly_date, @old_description, @new_description, @old_status, @new_status, @old_anomaly_id, @new_anomaly_id)
    `);
    const tx = db.transaction((list: Array<Omit<RecalcDetailItem, 'id' | 'created_at'>>) => {
      for (const it of list) stmt.run(it);
    });
    tx(items);
  },

  query(taskId: number, opts: { change_type?: DiffChangeType; anomaly_type?: string; grade?: string; class_name?: string; page?: number; page_size?: number } = {}): PagedResult<RecalcDetailItem> {
    const conds: string[] = ['task_id = ?'];
    const params: (string | number)[] = [taskId];
    if (opts.change_type) { conds.push('change_type = ?'); params.push(opts.change_type); }
    if (opts.anomaly_type) { conds.push('anomaly_type = ?'); params.push(opts.anomaly_type); }
    if (opts.grade) { conds.push('grade = ?'); params.push(opts.grade); }
    if (opts.class_name) { conds.push('class_name = ?'); params.push(opts.class_name); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM recalc_details ${where}`).get(...params) as { cnt: number };
    const page = opts.page || 1;
    const pageSize = opts.page_size || 50;
    const offset = (page - 1) * pageSize;
    const rows = db.prepare(`SELECT * FROM recalc_details ${where} ORDER BY anomaly_date DESC, grade, class_name, student_id LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as RecalcDetailItem[];
    return { data: rows, total: countRow.cnt, page, page_size: pageSize };
  },

  getAll(taskId: number): RecalcDetailItem[] {
    return db.prepare('SELECT * FROM recalc_details WHERE task_id = ? ORDER BY anomaly_date DESC, grade, class_name, student_id').all(taskId) as RecalcDetailItem[];
  },

  getCountsByChangeType(taskId: number): Record<string, number> {
    const rows = db.prepare('SELECT change_type, COUNT(*) as cnt FROM recalc_details WHERE task_id = ? GROUP BY change_type').all(taskId) as { change_type: string; cnt: number }[];
    const result: Record<string, number> = { added: 0, removed: 0, kept: 0, kept_modified: 0 };
    for (const r of rows) result[r.change_type] = r.cnt;
    return result;
  },

  computeSummary(taskId: number, totalBefore: number, totalAfter: number): RecalcSummary {
    const counts = recalcDetailRepo.getCountsByChangeType(taskId);

    const byGradeRows = db.prepare(`
      SELECT grade, change_type, COUNT(*) as cnt FROM recalc_details WHERE task_id = ? AND grade IS NOT NULL GROUP BY grade, change_type
    `).all(taskId) as { grade: string; change_type: string; cnt: number }[];
    const gradeMap = new Map<string, { grade: string; added: number; removed: number; kept: number }>();
    for (const r of byGradeRows) {
      if (!gradeMap.has(r.grade)) gradeMap.set(r.grade, { grade: r.grade, added: 0, removed: 0, kept: 0 });
      const g = gradeMap.get(r.grade)!;
      if (r.change_type === 'added') g.added = r.cnt;
      else if (r.change_type === 'removed') g.removed = r.cnt;
      else g.kept += r.cnt;
    }

    const byClassRows = db.prepare(`
      SELECT grade, class_name, change_type, COUNT(*) as cnt FROM recalc_details WHERE task_id = ? AND class_name IS NOT NULL GROUP BY grade, class_name, change_type
    `).all(taskId) as { grade: string; class_name: string; change_type: string; cnt: number }[];
    const classMap = new Map<string, { grade: string; class_name: string; added: number; removed: number; kept: number }>();
    for (const r of byClassRows) {
      const k = `${r.grade}|${r.class_name}`;
      if (!classMap.has(k)) classMap.set(k, { grade: r.grade, class_name: r.class_name, added: 0, removed: 0, kept: 0 });
      const c = classMap.get(k)!;
      if (r.change_type === 'added') c.added = r.cnt;
      else if (r.change_type === 'removed') c.removed = r.cnt;
      else c.kept += r.cnt;
    }

    const byTypeRows = db.prepare(`
      SELECT anomaly_type, change_type, COUNT(*) as cnt FROM recalc_details WHERE task_id = ? GROUP BY anomaly_type, change_type
    `).all(taskId) as { anomaly_type: string; change_type: string; cnt: number }[];
    const typeMap = new Map<string, { anomaly_type: RecalcSummary['by_type'][number]['anomaly_type']; added: number; removed: number; kept: number }>();
    for (const r of byTypeRows) {
      if (!typeMap.has(r.anomaly_type)) typeMap.set(r.anomaly_type, { anomaly_type: r.anomaly_type as RecalcSummary['by_type'][number]['anomaly_type'], added: 0, removed: 0, kept: 0 });
      const t = typeMap.get(r.anomaly_type)!;
      if (r.change_type === 'added') t.added = r.cnt;
      else if (r.change_type === 'removed') t.removed = r.cnt;
      else t.kept += r.cnt;
    }

    return {
      task_id: taskId,
      total_before: totalBefore,
      total_after: totalAfter,
      added: counts.added,
      removed: counts.removed,
      kept: counts.kept,
      kept_modified: counts.kept_modified,
      by_grade: Array.from(gradeMap.values()).sort((a, b) => a.grade.localeCompare(b.grade)),
      by_class: Array.from(classMap.values()).sort((a, b) => a.grade.localeCompare(b.grade) || a.class_name.localeCompare(b.class_name)),
      by_type: Array.from(typeMap.values()),
    };
  },
};

export const operationLogRepo = {
  create(log: Omit<OperationLog, 'id' | 'created_at'>): number {
    const info = db.prepare(`
      INSERT INTO operation_logs (action, operator, target_type, target_id, summary, detail_json)
      VALUES (@action, @operator, @target_type, @target_id, @summary, @detail_json)
    `).run({
      ...log,
      target_id: log.target_id !== undefined ? String(log.target_id) : null,
      detail_json: log.detail_json !== undefined ? JSON.stringify(log.detail_json) : null,
    });
    return Number(info.lastInsertRowid);
  },

  list(limit = 100): OperationLog[] {
    return db.prepare('SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT ?').all(limit) as OperationLog[];
  },

  clearAll(): void {
    db.prepare('DELETE FROM operation_logs').run();
  },
};
