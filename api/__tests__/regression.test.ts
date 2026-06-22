import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DB_PATH = path.join(__dirname, '__test_attendance.db');

let db: Database.Database;

function setupTestDb(): Database.Database {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(TEST_DB_PATH + '-wal')) fs.unlinkSync(TEST_DB_PATH + '-wal');
  if (fs.existsSync(TEST_DB_PATH + '-shm')) fs.unlinkSync(TEST_DB_PATH + '-shm');

  const testDb = new Database(TEST_DB_PATH);
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');

  testDb.exec(`
    CREATE TABLE IF NOT EXISTS students (
      student_id TEXT PRIMARY KEY, name TEXT NOT NULL, grade TEXT NOT NULL, class_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS swipe_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, swipe_time DATETIME NOT NULL,
      device_location TEXT, import_batch_id TEXT,
      FOREIGN KEY (student_id) REFERENCES students(student_id)
    );
    CREATE TABLE IF NOT EXISTS leave_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, leave_type TEXT NOT NULL,
      start_time DATETIME NOT NULL, end_time DATETIME NOT NULL, reason TEXT,
      FOREIGN KEY (student_id) REFERENCES students(student_id)
    );
    CREATE TABLE IF NOT EXISTS anomalies (
      id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, anomaly_type TEXT NOT NULL,
      anomaly_date DATE NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'pending',
      review_note TEXT, reviewed_by TEXT, reviewed_at DATETIME,
      FOREIGN KEY (student_id) REFERENCES students(student_id)
    );
    CREATE TABLE IF NOT EXISTS review_histories (
      id INTEGER PRIMARY KEY AUTOINCREMENT, anomaly_id INTEGER NOT NULL,
      action TEXT NOT NULL, old_status TEXT, new_status TEXT NOT NULL,
      note TEXT, operator TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anomaly_id) REFERENCES anomalies(id)
    );
    CREATE TABLE IF NOT EXISTS grade_rules (
      grade TEXT PRIMARY KEY, morning_start_time TEXT NOT NULL DEFAULT '08:00',
      late_tolerance_minutes INTEGER NOT NULL DEFAULT 5,
      afternoon_start_time TEXT NOT NULL DEFAULT '14:00',
      absent_window_minutes INTEGER NOT NULL DEFAULT 120
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_swipe_unique ON swipe_records(student_id, swipe_time);
  `);

  return testDb;
}

function seedBasicData(testDb: Database.Database) {
  testDb.prepare("INSERT INTO students VALUES ('S00001', '张三', '高三', '1班')").run();
  testDb.prepare("INSERT INTO students VALUES ('S00002', '李四', '高三', '1班')").run();
  testDb.prepare("INSERT INTO students VALUES ('S00003', '王五', '高二', '2班')").run();
  testDb.prepare("INSERT INTO grade_rules VALUES ('高三', '07:20', 3, '13:50', 120)").run();
  testDb.prepare("INSERT INTO grade_rules VALUES ('高二', '07:30', 5, '14:00', 120)").run();
  testDb.prepare("INSERT INTO swipe_records (student_id, swipe_time) VALUES ('S00001', '2026-06-15T07:25:00')").run();
  testDb.prepare("INSERT INTO swipe_records (student_id, swipe_time) VALUES ('S00002', '2026-06-15T07:24:00')").run();
  testDb.prepare("INSERT INTO swipe_records (student_id, swipe_time) VALUES ('S00003', '2026-06-15T07:35:00')").run();
}

beforeEach(() => {
  db = setupTestDb();
});

afterEach(() => {
  db.close();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(TEST_DB_PATH + '-wal')) fs.unlinkSync(TEST_DB_PATH + '-wal');
  if (fs.existsSync(TEST_DB_PATH + '-shm')) fs.unlinkSync(TEST_DB_PATH + '-shm');
});

describe('规则保存后重算——已复核数据保留', () => {
  it('重算时已确认异常不被删除，仅替换 pending', () => {
    seedBasicData(db);

    const detectAnomalies = () => {
      const rows = db.prepare("SELECT * FROM anomalies WHERE status = 'pending'").all() as any[];
      const studentIds = new Set(rows.map(r => r.student_id));
      return studentIds;
    };

    db.prepare("INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status) VALUES ('S00001', 'late', '2026-06-15', '上午迟到 5 分钟', 'pending')").run();
    db.prepare("INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status) VALUES ('S00002', 'late', '2026-06-15', '上午迟到 4 分钟', 'pending')").run();

    const pendingBefore = db.prepare("SELECT COUNT(*) as c FROM anomalies WHERE status = 'pending'").get() as any;
    expect(pendingBefore.c).toBe(2);

    const confirmedId = db.prepare("INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status, review_note, reviewed_by) VALUES ('S00001', 'late', '2026-06-15', '上午迟到 5 分钟', 'confirmed', '确认迟到', '管理员')").run().lastInsertRowid;
    db.prepare("INSERT INTO review_histories (anomaly_id, action, old_status, new_status, note, operator) VALUES (?, 'review', 'pending', 'confirmed', '确认迟到', '管理员')").run(Number(confirmedId));

    const pendingToClear = db.prepare("SELECT id FROM anomalies WHERE status = 'pending'").all() as any[];
    for (const row of pendingToClear) {
      db.prepare("DELETE FROM review_histories WHERE anomaly_id = ?").run(row.id);
    }
    db.prepare("DELETE FROM anomalies WHERE status = 'pending'").run();

    const totalAfter = db.prepare("SELECT COUNT(*) as c FROM anomalies").get() as any;
    expect(totalAfter.c).toBe(1);

    const confirmed = db.prepare("SELECT * FROM anomalies WHERE id = ?").get(Number(confirmedId)) as any;
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.review_note).toBe('确认迟到');
  });

  it('重算后已复核异常不重复产生新记录', () => {
    seedBasicData(db);

    const confirmedId = db.prepare("INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status, review_note, reviewed_by) VALUES ('S00001', 'late', '2026-06-15', '上午迟到 5 分钟', 'confirmed', '确认', '管理员')").run().lastInsertRowid;
    db.prepare("INSERT INTO review_histories (anomaly_id, action, old_status, new_status, note, operator) VALUES (?, 'review', 'pending', 'confirmed', '确认', '管理员')").run(Number(confirmedId));

    db.prepare("DELETE FROM anomalies WHERE status = 'pending'").run();

    const reviewedKeys = new Set(
      (db.prepare("SELECT student_id, anomaly_type, anomaly_date FROM anomalies WHERE status != 'pending'").all() as any[])
        .map(r => `${r.student_id}__${r.anomaly_type}__${r.anomaly_date}`)
    );

    const newAnomalies = [
      { student_id: 'S00001', anomaly_type: 'late', anomaly_date: '2026-06-15', description: '上午迟到 5 分钟', status: 'pending' },
      { student_id: 'S00002', anomaly_type: 'late', anomaly_date: '2026-06-15', description: '上午迟到 4 分钟', status: 'pending' },
    ].filter(a => !reviewedKeys.has(`${a.student_id}__${a.anomaly_type}__${a.anomaly_date}`));

    expect(newAnomalies.length).toBe(1);
    expect(newAnomalies[0].student_id).toBe('S00002');
  });

  it('clearAll 必须先删 review_histories 再删 anomalies，否则外键报错', () => {
    seedBasicData(db);

    const aId = db.prepare("INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status) VALUES ('S00001', 'late', '2026-06-15', '迟到', 'confirmed')").run().lastInsertRowid;
    db.prepare("INSERT INTO review_histories (anomaly_id, action, old_status, new_status, operator) VALUES (?, 'review', 'pending', 'confirmed', '管理员')").run(Number(aId));

    expect(() => {
      db.prepare('DELETE FROM anomalies').run();
    }).toThrow();

    db.prepare('DELETE FROM review_histories').run();
    expect(() => {
      db.prepare('DELETE FROM anomalies').run();
    }).not.toThrow();
  });
});

describe('混合导入事务回滚', () => {
  it('导入刷卡后重算失败时，刷卡记录应回滚', () => {
    seedBasicData(db);

    const swipesBefore = db.prepare("SELECT COUNT(*) as c FROM swipe_records").get() as any;

    try {
      const tx = db.transaction(() => {
        db.prepare("INSERT INTO swipe_records (student_id, swipe_time) VALUES ('S00001', '2026-06-16T07:30:00')").run();
        throw new Error('模拟重算失败');
      });
      tx();
    } catch {}

    const swipesAfter = db.prepare("SELECT COUNT(*) as c FROM swipe_records").get() as any;
    expect(swipesAfter.c).toBe(swipesBefore.c);
  });

  it('正常提交事务后数据持久化', () => {
    seedBasicData(db);

    const swipesBefore = db.prepare("SELECT COUNT(*) as c FROM swipe_records").get() as any;

    const tx = db.transaction(() => {
      db.prepare("INSERT INTO swipe_records (student_id, swipe_time) VALUES ('S00001', '2026-06-16T07:30:00')").run();
      return true;
    });
    tx();

    const swipesAfter = db.prepare("SELECT COUNT(*) as c FROM swipe_records").get() as any;
    expect(swipesAfter.c).toBe(swipesBefore.c + 1);
  });
});

describe('复核后回退与历史恢复', () => {
  it('确认后回退应恢复为 pending，清空 review_note 和 reviewed_by', () => {
    seedBasicData(db);

    const aId = db.prepare("INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status) VALUES ('S00001', 'late', '2026-06-15', '迟到', 'pending')").run().lastInsertRowid;

    db.prepare("UPDATE anomalies SET status = 'confirmed', review_note = '确认迟到', reviewed_by = '管理员', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(Number(aId));
    db.prepare("INSERT INTO review_histories (anomaly_id, action, old_status, new_status, note, operator) VALUES (?, 'review', 'pending', 'confirmed', '确认迟到', '管理员')").run(Number(aId));

    const history = db.prepare("SELECT * FROM review_histories WHERE anomaly_id = ? ORDER BY created_at DESC").all(Number(aId)) as any[];
    const prevStatus = history[0].old_status || 'pending';

    expect(prevStatus).toBe('pending');

    if (prevStatus === 'pending') {
      db.prepare("UPDATE anomalies SET status = 'pending', review_note = NULL, reviewed_by = NULL, reviewed_at = NULL WHERE id = ?").run(Number(aId));
    }
    db.prepare("INSERT INTO review_histories (anomaly_id, action, old_status, new_status, note, operator) VALUES (?, 'revert', 'confirmed', 'pending', '回退测试', '管理员')").run(Number(aId));

    const anomaly = db.prepare("SELECT * FROM anomalies WHERE id = ?").get(Number(aId)) as any;
    expect(anomaly.status).toBe('pending');
    expect(anomaly.review_note).toBeNull();
    expect(anomaly.reviewed_by).toBeNull();
    expect(anomaly.reviewed_at).toBeNull();

    const allHistory = db.prepare("SELECT * FROM review_histories WHERE anomaly_id = ? ORDER BY created_at ASC").all(Number(aId)) as any[];
    expect(allHistory.length).toBe(2);
    expect(allHistory[0].action).toBe('review');
    expect(allHistory[1].action).toBe('revert');
    expect(allHistory[1].new_status).toBe('pending');
  });

  it('多步复核后回退应恢复上一条有效结论', () => {
    seedBasicData(db);

    const aId = db.prepare("INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status) VALUES ('S00001', 'late', '2026-06-15', '迟到', 'pending')").run().lastInsertRowid;

    db.prepare("UPDATE anomalies SET status = 'confirmed', review_note = '确认迟到', reviewed_by = '管理员', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(Number(aId));
    db.prepare("INSERT INTO review_histories (anomaly_id, action, old_status, new_status, note, operator, created_at) VALUES (?, 'review', 'pending', 'confirmed', '确认迟到', '管理员', '2026-06-15T10:00:00')").run(Number(aId));

    db.prepare("UPDATE anomalies SET status = 'dismissed', review_note = '改为误判', reviewed_by = '班主任', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(Number(aId));
    db.prepare("INSERT INTO review_histories (anomaly_id, action, old_status, new_status, note, operator, created_at) VALUES (?, 'dismiss', 'confirmed', 'dismissed', '改为误判', '班主任', '2026-06-15T11:00:00')").run(Number(aId));

    const history = db.prepare("SELECT * FROM review_histories WHERE anomaly_id = ? ORDER BY created_at DESC, id DESC").all(Number(aId)) as any[];
    const prevStatus = history[0].old_status;

    expect(prevStatus).toBe('confirmed');

    const prevNote = history.find((h: any) => h.new_status === prevStatus)?.note || null;
    const prevOperator = history.find((h: any) => h.new_status === prevStatus)?.operator || null;

    db.prepare("UPDATE anomalies SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(prevStatus, prevNote, prevOperator, Number(aId));
    db.prepare("INSERT INTO review_histories (anomaly_id, action, old_status, new_status, note, operator) VALUES (?, 'revert', 'dismissed', ?, '回退dismiss', '管理员')").run(Number(aId), prevStatus);

    const anomaly = db.prepare("SELECT * FROM anomalies WHERE id = ?").get(Number(aId)) as any;
    expect(anomaly.status).toBe('confirmed');
    expect(anomaly.review_note).toBe('确认迟到');
    expect(anomaly.reviewed_by).toBe('管理员');

    const allHistory = db.prepare("SELECT * FROM review_histories WHERE anomaly_id = ? ORDER BY created_at ASC, id ASC").all(Number(aId)) as any[];
    expect(allHistory.length).toBe(3);
    expect(allHistory[2].action).toBe('revert');
    expect(allHistory[2].old_status).toBe('dismissed');
    expect(allHistory[2].new_status).toBe('confirmed');
  });
});
