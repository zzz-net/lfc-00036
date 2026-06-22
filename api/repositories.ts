import db from './db';
import type {
  Student,
  SwipeRecord,
  LeaveRecord,
  Anomaly,
  ReviewHistory,
  GradeRule,
  RuleVersion,
  AnomalyFilters,
  PagedResult,
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

  clearAll(): void {
    db.prepare('DELETE FROM anomalies').run();
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
      ORDER BY created_at DESC
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
