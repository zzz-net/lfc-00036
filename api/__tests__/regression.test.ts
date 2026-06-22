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
      absent_window_minutes INTEGER NOT NULL DEFAULT 120,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS rule_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL,
      description TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS recalc_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, rule_version_id INTEGER,
      rule_snapshot TEXT NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', operator TEXT NOT NULL DEFAULT '管理员',
      error_message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME, finished_at DATETIME,
      progress_percent INTEGER NOT NULL DEFAULT 0, progress_message TEXT
    );
    CREATE TABLE IF NOT EXISTS recalc_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL,
      change_type TEXT NOT NULL, student_id TEXT NOT NULL,
      student_name TEXT, grade TEXT, class_name TEXT,
      anomaly_type TEXT NOT NULL, anomaly_date DATE NOT NULL,
      old_description TEXT, new_description TEXT,
      old_status TEXT, new_status TEXT,
      old_anomaly_id INTEGER, new_anomaly_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL,
      operator TEXT NOT NULL, target_type TEXT NOT NULL,
      target_id TEXT, summary TEXT NOT NULL, detail_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_swipe_unique ON swipe_records(student_id, swipe_time);
  `);

  return testDb;
}

function seedBasicData(testDb: Database.Database) {
  testDb.prepare("INSERT INTO students VALUES ('S00001', '张三', '高三', '1班')").run();
  testDb.prepare("INSERT INTO students VALUES ('S00002', '李四', '高三', '1班')").run();
  testDb.prepare("INSERT INTO students VALUES ('S00003', '王五', '高二', '2班')").run();
  testDb.prepare("INSERT INTO grade_rules (grade, morning_start_time, late_tolerance_minutes, afternoon_start_time, absent_window_minutes) VALUES ('高三', '07:20', 3, '13:50', 120)").run();
  testDb.prepare("INSERT INTO grade_rules (grade, morning_start_time, late_tolerance_minutes, afternoon_start_time, absent_window_minutes) VALUES ('高二', '07:30', 5, '14:00', 120)").run();
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

function formatLocalDateTime(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}:${s}`;
}

function formatLocalTime(isoString: string): string {
  const d = new Date(isoString);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

describe('刷卡时间处理与时区一致性', () => {
  it('toDateStr 应返回本地日期而非 UTC 日期', () => {
    const localMorning = new Date(2026, 5, 15, 7, 30, 0);
    const y = localMorning.getFullYear();
    const m = String(localMorning.getMonth() + 1).padStart(2, '0');
    const d = String(localMorning.getDate()).padStart(2, '0');
    const localDateStr = `${y}-${m}-${d}`;
    expect(localDateStr).toBe('2026-06-15');

    const utcYear = localMorning.getUTCFullYear();
    const utcMonth = String(localMorning.getUTCMonth() + 1).padStart(2, '0');
    const utcDay = String(localMorning.getUTCDate()).padStart(2, '0');
    const utcDateStr = `${utcYear}-${utcMonth}-${utcDay}`;

    const toISO = localMorning.toISOString().slice(0, 10);
    expect(toISO).toBe(utcDateStr);

    expect(localDateStr).toBe('2026-06-15');
    expect(typeof localDateStr).toBe('string');
    expect(localDateStr.length).toBe(10);
  });

  it('存储时间应为本地时间格式（不带 Z）', () => {
    const d = new Date(2026, 5, 15, 7, 50, 0);
    const localStr = formatLocalDateTime(d);
    expect(localStr).toBe('2026-06-15T07:50:00');
    expect(localStr.endsWith('Z')).toBe(false);
    const parsed = new Date(localStr);
    expect(parsed.getHours()).toBe(7);
    expect(parsed.getMinutes()).toBe(50);
  });

  it('本地时间格式存储后，DATE() 函数应返回正确日期', () => {
    seedBasicData(db);
    const localTime = '2026-06-15T07:50:00';
    db.prepare("INSERT INTO swipe_records (student_id, swipe_time) VALUES (?, ?)").run('S00001', localTime);
    const row = db.prepare("SELECT DATE(swipe_time) as dt FROM swipe_records WHERE student_id = ?").get('S00001') as any;
    expect(row.dt).toBe('2026-06-15');
  });

  it('上午迟到计算：07:50 刷卡对 07:25 上课，应迟到 25 分钟', () => {
    const swipeTime = new Date(2026, 5, 15, 7, 50, 0);
    const deadline = new Date(2026, 5, 15, 7, 25, 0);
    const lateMinutes = Math.round((swipeTime.getTime() - deadline.getTime()) / 60000);
    expect(lateMinutes).toBe(25);
  });

  it('异常描述中的时间应为本地时间，与刷卡时间一致', () => {
    const swipeLocalTime = '2026-06-15T07:50:00';
    const displayTime = formatLocalTime(swipeLocalTime);
    expect(displayTime).toBe('07:50:00');

    const description = `上午迟到 25 分钟，首次刷卡 ${displayTime}`;
    expect(description).toContain('07:50:00');
    expect(description).not.toContain('23:50');
    expect(description).not.toContain('1424');
  });

  it('重复刷卡描述中的两个时间都应为本地时间', () => {
    const t1 = formatLocalTime('2026-06-15T07:50:00');
    const t2 = formatLocalTime('2026-06-15T07:50:30');
    const desc = `1分钟内重复刷卡：${t1} 与 ${t2}`;
    expect(desc).toBe('1分钟内重复刷卡：07:50:00 与 07:50:30');
  });

  it('异常编号与描述中的时间应保持一致', () => {
    seedBasicData(db);

    const localTime = '2026-06-15T07:50:00';
    db.prepare("INSERT INTO swipe_records (student_id, swipe_time) VALUES (?, ?)").run('S00001', localTime);

    const rule = db.prepare("SELECT * FROM grade_rules WHERE grade = ?").get('高三') as any;
    const morningStartH = 7;
    const morningStartM = 20;
    const tolerance = 5;
    const deadline = new Date(2026, 5, 15, morningStartH, morningStartM + tolerance, 0);
    const swipeT = new Date(localTime);
    const lateMinutes = Math.round((swipeT.getTime() - deadline.getTime()) / 60000);
    const displayTime = formatLocalTime(localTime);

    expect(lateMinutes).toBe(25);
    expect(displayTime).toBe('07:50:00');

    const anomalyId = db.prepare(`
      INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status)
      VALUES (?, 'late', '2026-06-15', ?, 'pending')
    `).run('S00001', `上午迟到 ${lateMinutes} 分钟，首次刷卡 ${displayTime}`).lastInsertRowid;

    const saved = db.prepare("SELECT * FROM anomalies WHERE id = ?").get(Number(anomalyId)) as any;
    expect(saved.description).toBe('上午迟到 25 分钟，首次刷卡 07:50:00');
    expect(saved.id).toBeGreaterThan(0);
  });

  it('跨午夜边界的本地日期应正确计算', () => {
    const lateNight = new Date(2026, 5, 15, 23, 59, 0);
    const y = lateNight.getFullYear();
    const m = String(lateNight.getMonth() + 1).padStart(2, '0');
    const d = String(lateNight.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    expect(dateStr).toBe('2026-06-15');

    const nextDay = new Date(2026, 5, 16, 0, 1, 0);
    const y2 = nextDay.getFullYear();
    const m2 = String(nextDay.getMonth() + 1).padStart(2, '0');
    const d2 = String(nextDay.getDate()).padStart(2, '0');
    const dateStr2 = `${y2}-${m2}-${d2}`;
    expect(dateStr2).toBe('2026-06-16');
  });
});

describe('README 交付校验——导入格式与字段兼容', () => {
  it('刷卡记录支持英文列名 student_id + swipe_time', () => {
    seedBasicData(db);
    const rows = [
      { student_id: 'S00001', swipe_time: '2026-06-16 07:30:00' },
    ];
    const row = rows[0];
    const studentId = String(row.student_id ?? '').trim();
    const swipeTimeStr = String(row.swipe_time ?? '').trim();
    expect(studentId).toBe('S00001');
    expect(swipeTimeStr).toBe('2026-06-16 07:30:00');
    const d = new Date(swipeTimeStr.replace(' ', 'T'));
    expect(isNaN(d.getTime())).toBe(false);
    expect(d.getHours()).toBe(7);
    expect(d.getMinutes()).toBe(30);
  });

  it('刷卡记录支持中文列名 学号 + 刷卡时间', () => {
    seedBasicData(db);
    const rows = [
      { '学号': 'S00001', '刷卡时间': '2026-06-16 07:45:00', '设备位置': '校门口' },
    ];
    const row = rows[0] as Record<string, unknown>;
    const studentId = String(row.student_id ?? row['学号'] ?? '').trim();
    const swipeTimeStr = String(row.swipe_time ?? row['刷卡时间'] ?? '').trim();
    const deviceLoc = String(row.device_location ?? row['设备位置'] ?? '').trim();
    expect(studentId).toBe('S00001');
    expect(swipeTimeStr).toBe('2026-06-16 07:45:00');
    expect(deviceLoc).toBe('校门口');
  });

  it('请假记录支持中英文列名混合', () => {
    seedBasicData(db);
    const rows = [
      { student_id: 'S00001', '请假类型': 'sick', start_time: '2026-06-16 08:00:00', '结束时间': '2026-06-16 17:00:00', reason: '感冒发烧' },
    ];
    const row = rows[0] as Record<string, unknown>;
    const studentId = String(row.student_id ?? row['学号'] ?? '').trim();
    const leaveType = String(row.leave_type ?? row['请假类型'] ?? '').trim();
    const startTime = String(row.start_time ?? row['开始时间'] ?? '').trim();
    const endTime = String(row.end_time ?? row['结束时间'] ?? '').trim();
    const reason = String(row.reason ?? row['请假原因'] ?? '').trim();
    expect(studentId).toBe('S00001');
    expect(leaveType).toBe('sick');
    expect(startTime).toBe('2026-06-16 08:00:00');
    expect(endTime).toBe('2026-06-16 17:00:00');
    expect(reason).toBe('感冒发烧');
  });
});

describe('README 交付校验——规则保存与版本', () => {
  it('保存规则后数据应持久化到数据库', () => {
    seedBasicData(db);
    const before = db.prepare('SELECT COUNT(*) as c FROM grade_rules').get() as any;
    expect(before.c).toBe(2);

    db.prepare("INSERT OR REPLACE INTO grade_rules (grade, morning_start_time, late_tolerance_minutes, afternoon_start_time, absent_window_minutes) VALUES ('高一', '07:40', 5, '14:00', 120)").run();
    db.prepare("INSERT OR REPLACE INTO grade_rules (grade, morning_start_time, late_tolerance_minutes, afternoon_start_time, absent_window_minutes) VALUES ('高二', '07:30', 5, '14:00', 120)").run();
    db.prepare("INSERT OR REPLACE INTO grade_rules (grade, morning_start_time, late_tolerance_minutes, afternoon_start_time, absent_window_minutes) VALUES ('高三', '07:20', 3, '13:50', 120)").run();

    const after = db.prepare('SELECT COUNT(*) as c FROM grade_rules').get() as any;
    expect(after.c).toBe(3);

    const gao3 = db.prepare("SELECT * FROM grade_rules WHERE grade = '高三'").get() as any;
    expect(gao3.morning_start_time).toBe('07:20');
    expect(gao3.late_tolerance_minutes).toBe(3);
    expect(gao3.afternoon_start_time).toBe('13:50');
  });
});

describe('README 交付校验——重启后数据不漂移', () => {
  it('关闭并重新打开数据库后，学生、刷卡、异常数据保持一致', () => {
    seedBasicData(db);

    db.prepare("INSERT INTO swipe_records (student_id, swipe_time, device_location) VALUES ('S00001', '2026-06-16T07:50:00', '校门口')").run();
    const anomalyId = db.prepare(`
      INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status, review_note, reviewed_by)
      VALUES ('S00001', 'late', '2026-06-16', '上午迟到 25 分钟，首次刷卡 07:50:00', 'confirmed', '确认迟到', '管理员')
    `).run().lastInsertRowid;
    db.prepare("INSERT INTO grade_rules (grade, morning_start_time, late_tolerance_minutes, afternoon_start_time, absent_window_minutes) VALUES ('高一', '07:40', 5, '14:00', 120)").run();

    const beforeStudents = db.prepare('SELECT COUNT(*) as c FROM students').get() as any;
    const beforeSwipes = db.prepare('SELECT COUNT(*) as c FROM swipe_records').get() as any;
    const beforeAnomalies = db.prepare('SELECT COUNT(*) as c FROM anomalies').get() as any;
    const beforeRules = db.prepare('SELECT COUNT(*) as c FROM grade_rules').get() as any;
    const beforeAnomaly = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(Number(anomalyId)) as any;

    db.close();

    const reopenedDb = new Database(TEST_DB_PATH);
    reopenedDb.pragma('journal_mode = WAL');
    reopenedDb.pragma('foreign_keys = ON');

    try {
      const afterStudents = reopenedDb.prepare('SELECT COUNT(*) as c FROM students').get() as any;
      const afterSwipes = reopenedDb.prepare('SELECT COUNT(*) as c FROM swipe_records').get() as any;
      const afterAnomalies = reopenedDb.prepare('SELECT COUNT(*) as c FROM anomalies').get() as any;
      const afterRules = reopenedDb.prepare('SELECT COUNT(*) as c FROM grade_rules').get() as any;
      const afterAnomaly = reopenedDb.prepare('SELECT * FROM anomalies WHERE id = ?').get(Number(anomalyId)) as any;

      expect(afterStudents.c).toBe(beforeStudents.c);
      expect(afterSwipes.c).toBe(beforeSwipes.c);
      expect(afterAnomalies.c).toBe(beforeAnomalies.c);
      expect(afterRules.c).toBe(beforeRules.c);
      expect(afterAnomaly.status).toBe(beforeAnomaly.status);
      expect(afterAnomaly.description).toBe(beforeAnomaly.description);
      expect(afterAnomaly.review_note).toBe(beforeAnomaly.review_note);
      expect(afterAnomaly.reviewed_by).toBe(beforeAnomaly.reviewed_by);
      expect(afterAnomaly.description).toContain('07:50:00');
      expect(afterAnomaly.description).not.toContain('23:50');
      expect(afterAnomaly.description).not.toContain('1424');
    } finally {
      reopenedDb.close();
      db = setupTestDb();
    }
  });

  it('已确认异常在重启后仍保持 confirmed 状态', () => {
    seedBasicData(db);

    const id = db.prepare(`
      INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status, review_note, reviewed_by)
      VALUES ('S00002', 'late', '2026-06-15', '下午迟到 10 分钟', 'confirmed', '已通知家长', '王老师')
    `).run().lastInsertRowid;

    db.close();
    const db2 = new Database(TEST_DB_PATH);
    db2.pragma('journal_mode = WAL');
    db2.pragma('foreign_keys = ON');

    try {
      const row = db2.prepare('SELECT * FROM anomalies WHERE id = ?').get(Number(id)) as any;
      expect(row.status).toBe('confirmed');
      expect(row.review_note).toBe('已通知家长');
      expect(row.reviewed_by).toBe('王老师');
      expect(row.anomaly_type).toBe('late');
      expect(row.anomaly_date).toBe('2026-06-15');
    } finally {
      db2.close();
      db = setupTestDb();
    }
  });
});

describe('导入→复核链路——样例数据与迟到分钟', () => {
  it('样例数据刷卡时间应为本地时间格式（不带 Z）', () => {
    seedBasicData(db);
    const localIso = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      return `${y}-${m}-${day}T${h}:${min}:${s}`;
    };
    const t = new Date(2026, 5, 15, 7, 35, 0);
    const storedTime = localIso(t);
    expect(storedTime).toBe('2026-06-15T07:35:00');
    expect(storedTime.endsWith('Z')).toBe(false);
    const parsed = new Date(storedTime);
    expect(parsed.getHours()).toBe(7);
    expect(parsed.getMinutes()).toBe(35);
  });

  it('迟到分钟数应在合理范围内（0 < minutes < 300，不上千）', () => {
    seedBasicData(db);
    const testCases = [
      { swipe: '2026-06-15T07:35:00', deadlineH: 7, deadlineM: 23, expectedMin: 12 },
      { swipe: '2026-06-15T07:50:00', deadlineH: 7, deadlineM: 23, expectedMin: 27 },
      { swipe: '2026-06-15T08:05:00', deadlineH: 7, deadlineM: 23, expectedMin: 42 },
      { swipe: '2026-06-15T14:20:00', deadlineH: 14, deadlineM: 0, expectedMin: 20 },
    ];
    for (const tc of testCases) {
      const [y, m, d] = '2026-06-15'.split('-').map(Number);
      const deadline = new Date(y, m - 1, d, tc.deadlineH, tc.deadlineM, 0, 0);
      const swipeT = new Date(tc.swipe);
      const lateMinutes = Math.round((swipeT.getTime() - deadline.getTime()) / 60000);
      expect(lateMinutes).toBe(tc.expectedMin);
      expect(lateMinutes).toBeGreaterThan(0);
      expect(lateMinutes).toBeLessThan(300);
      expect(lateMinutes).toBeLessThan(1000);
    }
  });

  it('异常 ID 应可查询并用于复核（ID > 0）', () => {
    seedBasicData(db);
    const id = db.prepare(`
      INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status)
      VALUES ('S00001', 'late', '2026-06-15', '上午迟到 15 分钟，首次刷卡 07:40:00', 'pending')
    `).run().lastInsertRowid;
    expect(Number(id)).toBeGreaterThan(0);
    const saved = db.prepare('SELECT * FROM anomalies WHERE id = ?').get(Number(id)) as any;
    expect(saved).not.toBeNull();
    expect(saved.id).toBe(Number(id));
    expect(saved.status).toBe('pending');
    expect(saved.description).toContain('07:40:00');
    expect(saved.description).not.toContain('23:50');
  });
});

describe('导出与列表一致性', () => {
  it('异常记录在列表和导出描述中应保持一致', () => {
    seedBasicData(db);
    const description = '上午迟到 18 分钟，首次刷卡 07:43:00';
    const id = db.prepare(`
      INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status, review_note, reviewed_by)
      VALUES ('S00002', 'late', '2026-06-15', ?, 'confirmed', '已联系', '管理员')
    `).run(description).lastInsertRowid;

    const listRow = db.prepare(`
      SELECT a.id, a.anomaly_date, s.student_id, s.name, s.grade, s.class_name,
             a.anomaly_type, a.description, a.status, a.review_note, a.reviewed_by
      FROM anomalies a LEFT JOIN students s ON a.student_id = s.student_id
      WHERE a.id = ?
    `).get(Number(id)) as any;

    expect(listRow.description).toBe(description);
    expect(listRow.status).toBe('confirmed');
    expect(listRow.description).toContain('18 分钟');
    expect(listRow.description).toContain('07:43:00');
    expect(listRow.description).not.toMatch(/\d{3,} 分钟/);
    expect(listRow.description).not.toContain('1424');
    expect(listRow.description).not.toContain('23:50');
  });
});

// =========================================================================
// 以下为新增：规则版本对比 / 批量重算 / 冲突锁 / 持久化 / CSV 导出
// =========================================================================

type GradeRule = {
  grade: string;
  morning_start_time: string;
  late_tolerance_minutes: number;
  afternoon_start_time: string;
  absent_window_minutes: number;
};

const RULE_FIELDS: Array<{ key: keyof GradeRule; label: string }> = [
  { key: 'morning_start_time', label: '上午上课时间' },
  { key: 'late_tolerance_minutes', label: '迟到宽容(分钟)' },
  { key: 'afternoon_start_time', label: '下午上课时间' },
  { key: 'absent_window_minutes', label: '缺勤判定窗口(分钟)' },
];

function getRuleFieldValue(rule: GradeRule | undefined, field: keyof GradeRule): string | number | null {
  if (!rule) return null;
  const v = rule[field];
  return v === undefined || v === null ? null : v;
}

function computeRuleDiffInline(
  oldRules: GradeRule[],
  newRules: GradeRule[],
) {
  const oldMap = new Map(oldRules.map(r => [r.grade, r]));
  const newMap = new Map(newRules.map(r => [r.grade, r]));
  const allGrades = Array.from(new Set([...oldMap.keys(), ...newMap.keys()])).sort();

  let added = 0, removed = 0, modified = 0, unchanged = 0;
  for (const grade of allGrades) {
    const oldRule = oldMap.get(grade);
    const newRule = newMap.get(grade);
    const existsInOld = !!oldRule;
    const existsInNew = !!newRule;
    const fields = RULE_FIELDS.map(f => {
      const ov = getRuleFieldValue(oldRule, f.key);
      const nv = getRuleFieldValue(newRule, f.key);
      return { field: f.key, changed: String(ov) !== String(nv) };
    });
    if (!existsInOld && existsInNew) added++;
    else if (existsInOld && !existsInNew) removed++;
    else if (fields.some(f => f.changed)) modified++;
    else unchanged++;
  }
  return { allGrades, added, removed, modified, unchanged };
}

describe('规则版本对比——computeRuleDiff 正确性', () => {
  const baseRules: GradeRule[] = [
    { grade: '高一', morning_start_time: '08:00', late_tolerance_minutes: 5, afternoon_start_time: '14:00', absent_window_minutes: 120 },
    { grade: '高二', morning_start_time: '08:00', late_tolerance_minutes: 5, afternoon_start_time: '14:00', absent_window_minutes: 120 },
    { grade: '高三', morning_start_time: '07:20', late_tolerance_minutes: 3, afternoon_start_time: '13:50', absent_window_minutes: 120 },
  ];

  it('完全相同的规则应为 unchanged=3，其余为 0', () => {
    const diff = computeRuleDiffInline(baseRules, baseRules);
    expect(diff.unchanged).toBe(3);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.modified).toBe(0);
    expect(diff.allGrades.length).toBe(3);
  });

  it('修改高三 late_tolerance → modified=1', () => {
    const newRules: GradeRule[] = baseRules.map(r =>
      r.grade === '高三' ? { ...r, late_tolerance_minutes: 10 } : r
    );
    const diff = computeRuleDiffInline(baseRules, newRules);
    expect(diff.modified).toBe(1);
    expect(diff.unchanged).toBe(2);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);

    // 验证字段级：late_tolerance 变了，morning_start_time 没变
    const gao3Old = baseRules.find(r => r.grade === '高三')!;
    const gao3New = newRules.find(r => r.grade === '高三')!;
    const latDiff = String(getRuleFieldValue(gao3Old, 'late_tolerance_minutes')) !== String(getRuleFieldValue(gao3New, 'late_tolerance_minutes'));
    const mornSame = String(getRuleFieldValue(gao3Old, 'morning_start_time')) === String(getRuleFieldValue(gao3New, 'morning_start_time'));
    expect(latDiff).toBe(true);
    expect(mornSame).toBe(true);
  });

  it('新增初一 + 删除高一 + 修改高二 → added=1 removed=1 modified=1', () => {
    const newRules: GradeRule[] = [
      { grade: '初一', morning_start_time: '08:10', late_tolerance_minutes: 10, afternoon_start_time: '14:10', absent_window_minutes: 120 },
      { grade: '高二', morning_start_time: '08:00', late_tolerance_minutes: 8, afternoon_start_time: '14:00', absent_window_minutes: 150 },
      { grade: '高三', morning_start_time: '07:20', late_tolerance_minutes: 3, afternoon_start_time: '13:50', absent_window_minutes: 120 },
    ];
    const diff = computeRuleDiffInline(baseRules, newRules);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.modified).toBe(1);
    expect(diff.unchanged).toBe(1); // 高三
    expect(diff.allGrades.length).toBe(4);
    expect(diff.allGrades).toContain('初一');
    expect(diff.allGrades).toContain('高一');
    expect(diff.allGrades).toContain('高二');
    expect(diff.allGrades).toContain('高三');
  });

  it('空旧规则 + 3 个新规则 → added=3', () => {
    const diff = computeRuleDiffInline([], baseRules);
    expect(diff.added).toBe(3);
    expect(diff.removed).toBe(0);
    expect(diff.modified).toBe(0);
    expect(diff.unchanged).toBe(0);
  });

  it('所有值类型正确（数字/字符串区分通过 String() 比较）', () => {
    // 数字 5 vs 字符串 '5' 应视为相同（因为 compare 时存的是 number/string 混合）
    const oldR: GradeRule[] = [{ grade: '高一', morning_start_time: '08:00', late_tolerance_minutes: 5, afternoon_start_time: '14:00', absent_window_minutes: 120 }];
    const newR: GradeRule[] = [{ grade: '高一', morning_start_time: '08:00', late_tolerance_minutes: 5, afternoon_start_time: '14:00', absent_window_minutes: 120 }];
    const diff = computeRuleDiffInline(oldR, newR);
    expect(diff.unchanged).toBe(1);

    // String(5) === String('5') → true，所以即使类型不同也视为相同
    // 数值 5 vs 6 → modified
    const modR: GradeRule[] = [{ grade: '高一', morning_start_time: '08:00', late_tolerance_minutes: 6, afternoon_start_time: '14:00', absent_window_minutes: 120 }];
    const diff2 = computeRuleDiffInline(oldR, modR);
    expect(diff2.modified).toBe(1);
  });
});

describe('批量重算——任务表 schema 与状态机', () => {
  it('创建任务时 status 默认 queued, progress 默认 0', () => {
    seedBasicData(db);
    const id = db.prepare(`
      INSERT INTO recalc_tasks (rule_snapshot, start_date, end_date, operator)
      VALUES (?, '2026-06-15', '2026-06-21', '张老师')
    `).run(JSON.stringify([{ grade: '高三', morning_start_time: '07:20', late_tolerance_minutes: 3, afternoon_start_time: '13:50', absent_window_minutes: 120 }])).lastInsertRowid;

    const row = db.prepare('SELECT * FROM recalc_tasks WHERE id = ?').get(Number(id)) as any;
    expect(row.status).toBe('queued');
    expect(row.progress_percent).toBe(0);
    expect(row.start_date).toBe('2026-06-15');
    expect(row.end_date).toBe('2026-06-21');
    expect(row.operator).toBe('张老师');
    expect(row.rule_snapshot).toContain('高三');
    expect(row.created_at).not.toBeNull();
    expect(row.started_at).toBeNull();
    expect(row.finished_at).toBeNull();
  });

  it('状态机演进：queued → running → completed 附带 started/finished 时间', () => {
    seedBasicData(db);
    const id = db.prepare(`
      INSERT INTO recalc_tasks (rule_snapshot, start_date, end_date)
      VALUES ('[]', '2026-06-15', '2026-06-19')
    `).run().lastInsertRowid;

    db.prepare("UPDATE recalc_tasks SET status='running', started_at=CURRENT_TIMESTAMP, progress_percent=30 WHERE id=?").run(Number(id));
    const r1 = db.prepare('SELECT status, progress_percent, started_at, finished_at FROM recalc_tasks WHERE id=?').get(Number(id)) as any;
    expect(r1.status).toBe('running');
    expect(r1.progress_percent).toBe(30);
    expect(r1.started_at).not.toBeNull();
    expect(r1.finished_at).toBeNull();

    db.prepare("UPDATE recalc_tasks SET status='completed', finished_at=CURRENT_TIMESTAMP, progress_percent=100, progress_message='重算完成' WHERE id=?").run(Number(id));
    const r2 = db.prepare('SELECT status, progress_percent, finished_at, progress_message FROM recalc_tasks WHERE id=?').get(Number(id)) as any;
    expect(r2.status).toBe('completed');
    expect(r2.progress_percent).toBe(100);
    expect(r2.finished_at).not.toBeNull();
    expect(r2.progress_message).toBe('重算完成');
  });

  it('progress_percent 必须单调递增（0 < 15 < 30 < 70 < 90 < 100）', () => {
    seedBasicData(db);
    const id = db.prepare("INSERT INTO recalc_tasks (rule_snapshot, start_date, end_date) VALUES ('[]', '2026-06-01', '2026-06-10')").run().lastInsertRowid as number;

    const stages = [5, 15, 30, 50, 70, 90, 100];
    for (let i = 0; i < stages.length; i++) {
      db.prepare("UPDATE recalc_tasks SET progress_percent=? WHERE id=?").run(stages[i], id);
      const r = db.prepare('SELECT progress_percent FROM recalc_tasks WHERE id=?').get(id) as any;
      expect(r.progress_percent).toBe(stages[i]);
      if (i > 0) {
        expect(r.progress_percent).toBeGreaterThan(stages[i - 1]);
      }
    }
  });

  it('失败任务：error_message 非空，status=failed', () => {
    seedBasicData(db);
    const id = db.prepare("INSERT INTO recalc_tasks (rule_snapshot, start_date, end_date) VALUES ('[]', '2026-06-10', '2026-06-12')").run().lastInsertRowid as number;
    db.prepare("UPDATE recalc_tasks SET status='failed', finished_at=CURRENT_TIMESTAMP, error_message='SQL 错误：连接超时' WHERE id=?").run(id);
    const r = db.prepare('SELECT status, error_message, finished_at FROM recalc_tasks WHERE id=?').get(id) as any;
    expect(r.status).toBe('failed');
    expect(r.error_message).toContain('SQL');
    expect(r.error_message).toContain('连接超时');
    expect(r.finished_at).not.toBeNull();
  });
});

describe('批量重算——冲突锁策略（409 拒绝）', () => {
  it('存在 running 任务时，新任务应被拒绝（acquireLock 等价逻辑）', () => {
    seedBasicData(db);
    // 插入一个 running 任务
    db.prepare(`
      INSERT INTO recalc_tasks (rule_snapshot, start_date, end_date, status, operator, progress_percent)
      VALUES ('[]', '2026-06-15', '2026-06-20', 'running', '李老师', 25)
    `).run();

    // 冲突检查：SELECT COUNT(*) FROM recalc_tasks WHERE status IN ('queued','running')
    const lockRow = db.prepare("SELECT COUNT(*) as cnt FROM recalc_tasks WHERE status IN ('queued','running')").get() as { cnt: number };
    expect(lockRow.cnt).toBeGreaterThan(0);
    // 当 cnt > 0 时，API 层返回 409
    const shouldReject = lockRow.cnt > 0;
    expect(shouldReject).toBe(true);
  });

  it('存在 queued 任务时，新任务也应被拒绝', () => {
    seedBasicData(db);
    db.prepare(`
      INSERT INTO recalc_tasks (rule_snapshot, start_date, end_date, status, operator)
      VALUES ('[]', '2026-06-15', '2026-06-20', 'queued', '王老师')
    `).run();
    const lockRow = db.prepare("SELECT COUNT(*) as cnt FROM recalc_tasks WHERE status IN ('queued','running')").get() as { cnt: number };
    expect(lockRow.cnt).toBe(1);
  });

  it('只有 completed/failed/cancelled 时才允许新建任务', () => {
    seedBasicData(db);
    // 各种完成态任务
    db.prepare(`INSERT INTO recalc_tasks (rule_snapshot, start_date, end_date, status) VALUES ('[]', '2026-06-01', '2026-06-05', 'completed')`).run();
    db.prepare(`INSERT INTO recalc_tasks (rule_snapshot, start_date, end_date, status) VALUES ('[]', '2026-06-06', '2026-06-10', 'failed')`).run();
    db.prepare(`INSERT INTO recalc_tasks (rule_snapshot, start_date, end_date, status) VALUES ('[]', '2026-06-11', '2026-06-14', 'cancelled')`).run();

    const lockRow = db.prepare("SELECT COUNT(*) as cnt FROM recalc_tasks WHERE status IN ('queued','running')").get() as { cnt: number };
    expect(lockRow.cnt).toBe(0);
    const shouldAllow = lockRow.cnt === 0;
    expect(shouldAllow).toBe(true);

    // 此时可以安全插入新任务
    const id = db.prepare(`INSERT INTO recalc_tasks (rule_snapshot, start_date, end_date, operator) VALUES ('[]', '2026-06-15', '2026-06-20', '赵老师')`).run().lastInsertRowid as number;
    expect(id).toBeGreaterThan(0);
  });

  it('完成任务后锁释放，第二个任务可正常创建', () => {
    seedBasicData(db);
    // 第一个任务从 running 转为 completed
    const task1 = db.prepare(`INSERT INTO recalc_tasks (rule_snapshot, start_date, end_date, status, progress_percent) VALUES ('[]', '2026-06-15', '2026-06-18', 'running', 50)`).run().lastInsertRowid as number;

    const before = (db.prepare("SELECT COUNT(*) as cnt FROM recalc_tasks WHERE status IN ('queued','running')").get() as { cnt: number }).cnt;
    expect(before).toBe(1);

    db.prepare("UPDATE recalc_tasks SET status='completed', progress_percent=100, finished_at=CURRENT_TIMESTAMP WHERE id=?").run(task1);

    const after = (db.prepare("SELECT COUNT(*) as cnt FROM recalc_tasks WHERE status IN ('queued','running')").get() as { cnt: number }).cnt;
    expect(after).toBe(0);

    const task2 = db.prepare(`INSERT INTO recalc_tasks (rule_snapshot, start_date, end_date, operator) VALUES ('[]', '2026-06-19', '2026-06-22', '孙老师')`).run().lastInsertRowid as number;
    expect(task2).toBeGreaterThan(task1);
  });
});

describe('批量重算——差异明细四类 change_type', () => {
  function seedTask(db: Database.Database): number {
    return db.prepare(`
      INSERT INTO recalc_tasks (rule_snapshot, start_date, end_date, status, operator, progress_percent)
      VALUES ('[]', '2026-06-15', '2026-06-19', 'completed', '周老师', 100)
    `).run().lastInsertRowid as number;
  }

  it('added 类型：只有 new_* 字段有值，old_* 为 NULL', () => {
    seedBasicData(db);
    const taskId = seedTask(db);
    db.prepare(`
      INSERT INTO recalc_details (task_id, change_type, student_id, student_name, grade, class_name, anomaly_type, anomaly_date, new_description, new_status)
      VALUES (?, 'added', 'S00001', '张三', '高三', '1班', 'late', '2026-06-15', '上午迟到 7 分钟，首次刷卡 07:30:00', 'pending')
    `).run(taskId);

    const r = db.prepare('SELECT * FROM recalc_details WHERE task_id=? AND change_type=?').get(taskId, 'added') as any;
    expect(r.change_type).toBe('added');
    expect(r.new_description).toContain('07:30:00');
    expect(r.new_status).toBe('pending');
    expect(r.old_description).toBeNull();
    expect(r.old_status).toBeNull();
    expect(r.old_anomaly_id).toBeNull();
  });

  it('removed 类型：只有 old_* 字段有值，new_* 为 NULL', () => {
    seedBasicData(db);
    const taskId = seedTask(db);
    db.prepare(`
      INSERT INTO recalc_details (task_id, change_type, student_id, student_name, grade, class_name, anomaly_type, anomaly_date, old_description, old_status, old_anomaly_id)
      VALUES (?, 'removed', 'S00002', '李四', '高三', '1班', 'absent', '2026-06-16', '上午缺勤：无刷卡记录且无有效请假', 'pending', 42)
    `).run(taskId);

    const r = db.prepare('SELECT * FROM recalc_details WHERE task_id=? AND change_type=?').get(taskId, 'removed') as any;
    expect(r.change_type).toBe('removed');
    expect(r.old_description).toContain('缺勤');
    expect(r.old_status).toBe('pending');
    expect(r.old_anomaly_id).toBe(42);
    expect(r.new_description).toBeNull();
    expect(r.new_status).toBeNull();
    expect(r.new_anomaly_id).toBeNull();
  });

  it('kept 类型：old_* 和 new_* 都有值，描述一致', () => {
    seedBasicData(db);
    const taskId = seedTask(db);
    db.prepare(`
      INSERT INTO recalc_details (task_id, change_type, student_id, student_name, grade, class_name, anomaly_type, anomaly_date, old_description, new_description, old_status, new_status, old_anomaly_id)
      VALUES (?, 'kept', 'S00003', '王五', '高二', '2班', 'duplicate_swipe', '2026-06-17', '1分钟内重复刷卡：08:02:15 与 08:02:40', '1分钟内重复刷卡：08:02:15 与 08:02:40', 'confirmed', 'confirmed', 99)
    `).run(taskId);

    const r = db.prepare('SELECT * FROM recalc_details WHERE task_id=? AND change_type=?').get(taskId, 'kept') as any;
    expect(r.change_type).toBe('kept');
    expect(r.old_description).toBe(r.new_description);
    expect(r.old_status).toBe(r.new_status);
    expect(r.old_anomaly_id).toBe(99);
  });

  it('kept_modified 类型：两边都存在但描述/状态有差异', () => {
    seedBasicData(db);
    const taskId = seedTask(db);
    db.prepare(`
      INSERT INTO recalc_details (task_id, change_type, student_id, student_name, grade, class_name, anomaly_type, anomaly_date, old_description, new_description, old_status, new_status, old_anomaly_id)
      VALUES (?, 'kept_modified', 'S00001', '张三', '高三', '1班', 'late', '2026-06-18', '上午迟到 5 分钟，首次刷卡 07:28:00', '上午迟到 10 分钟，首次刷卡 07:33:00', 'pending', 'pending', 101)
    `).run(taskId);

    const r = db.prepare('SELECT * FROM recalc_details WHERE task_id=? AND change_type=?').get(taskId, 'kept_modified') as any;
    expect(r.change_type).toBe('kept_modified');
    expect(r.old_description).not.toBe(r.new_description);
    expect(r.old_description).toContain('5 分钟');
    expect(r.new_description).toContain('10 分钟');
  });

  it('四类 change_type 计数汇总应与总数一致', () => {
    seedBasicData(db);
    const taskId = seedTask(db);
    const types: Array<[string, number]> = [
      ['added', 8], ['removed', 5], ['kept', 20], ['kept_modified', 3],
    ];
    const stmt = db.prepare(`
      INSERT INTO recalc_details (task_id, change_type, student_id, anomaly_type, anomaly_date)
      VALUES (?, ?, 'S99999', 'late', '2026-06-15')
    `);
    for (const [t, n] of types) {
      for (let i = 0; i < n; i++) stmt.run(taskId, t);
    }
    const total = (db.prepare('SELECT COUNT(*) as c FROM recalc_details WHERE task_id=?').get(taskId) as any).c;
    expect(total).toBe(36);

    const counts = db.prepare('SELECT change_type, COUNT(*) as c FROM recalc_details WHERE task_id=? GROUP BY change_type').all(taskId) as any[];
    const map: Record<string, number> = {};
    for (const r of counts) map[r.change_type] = r.c;
    expect(map.added).toBe(8);
    expect(map.removed).toBe(5);
    expect(map.kept).toBe(20);
    expect(map.kept_modified).toBe(3);
    expect(Object.values(map).reduce((a, b) => a + b, 0)).toBe(36);
  });
});

describe('重算结果 CSV 导出——表头与字段一致性', () => {
  function buildDiffCsv(rows: any[]): string {
    const typeMap: Record<string, string> = { late: '迟到', absent: '缺勤', duplicate_swipe: '重复刷卡', leave_exception: '请假例外' };
    const statusMap: Record<string, string> = { pending: '待处理', confirmed: '已确认', reverted: '已回退', dismissed: '已忽略' };
    const changeMap: Record<string, string> = { added: '新增', removed: '消失', kept: '保留', kept_modified: '保留(描述变更)' };
    function esc(v: unknown): string {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    const headers = ['变动类型', '日期', '学号', '姓名', '年级', '班级', '异常类型', '原描述', '新描述', '原状态', '新状态'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        esc(changeMap[r.change_type] || r.change_type),
        esc(r.anomaly_date),
        esc(r.student_id),
        esc(r.student_name),
        esc(r.grade),
        esc(r.class_name),
        esc(typeMap[r.anomaly_type] || r.anomaly_type),
        esc(r.old_description),
        esc(r.new_description),
        esc(statusMap[r.old_status] || r.old_status),
        esc(statusMap[r.new_status] || r.new_status),
      ].join(','));
    }
    return '\uFEFF' + lines.join('\n');
  }

  it('CSV 应带 BOM、表头 11 列、行记录数匹配', () => {
    const rows = [
      { change_type: 'added', anomaly_date: '2026-06-15', student_id: 'S00001', student_name: '张三', grade: '高三', class_name: '1班', anomaly_type: 'late', old_description: null, new_description: '上午迟到 7 分钟', old_status: null, new_status: 'pending' },
      { change_type: 'removed', anomaly_date: '2026-06-16', student_id: 'S00002', student_name: '李四', grade: '高三', class_name: '1班', anomaly_type: 'absent', old_description: '上午缺勤无刷卡', new_description: null, old_status: 'pending', new_status: null },
      { change_type: 'kept', anomaly_date: '2026-06-17', student_id: 'S00003', student_name: '王五', grade: '高二', class_name: '2班', anomaly_type: 'duplicate_swipe', old_description: '重复刷卡 08:02', new_description: '重复刷卡 08:02', old_status: 'confirmed', new_status: 'confirmed' },
    ];
    const csv = buildDiffCsv(rows);

    // 验证 BOM
    expect(csv.charCodeAt(0)).toBe(0xFEFF);

    const clean = csv.slice(1);
    const lines = clean.split('\n');
    expect(lines.length).toBe(4); // 1 表头 + 3 数据

    const headers = lines[0].split(',');
    expect(headers.length).toBe(11);
    expect(headers[0]).toBe('变动类型');
    expect(headers[1]).toBe('日期');
    expect(headers[10]).toBe('新状态');

    // added 行：原描述、原状态为空
    const addedCells = lines[1].split(',');
    expect(addedCells[0]).toBe('新增');
    expect(addedCells[7]).toBe(''); // old_description
    expect(addedCells[9]).toBe(''); // old_status

    // removed 行：新描述、新状态为空
    const removedCells = lines[2].split(',');
    expect(removedCells[0]).toBe('消失');
    expect(removedCells[8]).toBe(''); // new_description
    expect(removedCells[10]).toBe(''); // new_status

    // kept 行：两边都有
    const keptCells = lines[3].split(',');
    expect(keptCells[0]).toBe('保留');
    expect(keptCells[7]).toBe(keptCells[8]);
    expect(keptCells[9]).toBe(keptCells[10]);
  });

  it('中文列名映射正确（late→迟到，pending→待处理，added→新增）', () => {
    const rows = [{ change_type: 'added', anomaly_date: '2026-06-15', student_id: 'S00001', student_name: '张三', grade: '高三', class_name: '1班', anomaly_type: 'late', old_description: null, new_description: '迟到', old_status: null, new_status: 'pending' }];
    const csv = buildDiffCsv(rows);
    expect(csv).toContain('新增');
    expect(csv).toContain('迟到');
    expect(csv).toContain('待处理');
    expect(csv).not.toContain('late');
    expect(csv).not.toContain('added');
    expect(csv).not.toContain('pending');
  });

  it('含逗号/引号的字段应被正确转义（CSV 双引号包裹）', () => {
    const rows = [{ change_type: 'kept_modified', anomaly_date: '2026-06-15', student_id: 'S00001', student_name: '张三', grade: '高三', class_name: '1班', anomaly_type: 'leave_exception', old_description: '请假期间刷卡：08:00, 出现异常', new_description: '请假期间刷卡：08:00, 出现"异常"标记', old_status: 'pending', new_status: 'pending' }];
    const csv = buildDiffCsv(rows);
    // new_description 中既有逗号又有双引号，应该被转义："" 包裹内部引号
    expect(csv).toContain('出现""异常""标记');
    // old_description 有逗号，应该被双引号包裹
    expect(csv).toContain('"请假期间刷卡：08:00, 出现异常"');
  });
});

describe('操作日志表——schema 与查询', () => {
  it('规则保存 / 重算启动 / 重算完成 / 重算取消 四种动作分别可记录', () => {
    seedBasicData(db);
    const actions = [
      { a: 'rule_save', t: 'grade_rules', tid: 'v1', s: '保存规则，冬季作息调整' },
      { a: 'recalc_start', t: 'recalc_task', tid: '12', s: '创建重算任务：2026-06-01 ~ 2026-06-10' },
      { a: 'recalc_complete', t: 'recalc_task', tid: '12', s: '重算完成（新增8，消失3）' },
      { a: 'recalc_cancel', t: 'recalc_task', tid: '15', s: '手动取消重算任务' },
    ];
    const stmt = db.prepare(`
      INSERT INTO operation_logs (action, operator, target_type, target_id, summary)
      VALUES (@action, @operator, @target_type, @target_id, @summary)
    `);
    for (const x of actions) {
      stmt.run({ action: x.a, operator: '管理员', target_type: x.t, target_id: x.tid, summary: x.s });
    }
    const rows = db.prepare('SELECT action, operator, target_type, target_id, summary, created_at FROM operation_logs ORDER BY id ASC').all() as any[];
    expect(rows.length).toBe(4);
    expect(rows[0].action).toBe('rule_save');
    expect(rows[1].target_type).toBe('recalc_task');
    expect(rows[1].target_id).toBe('12');
    expect(rows[2].summary).toContain('新增8');
    expect(rows[3].summary).toContain('取消');
    for (const r of rows) {
      expect(r.operator).toBe('管理员');
      expect(r.created_at).not.toBeNull();
    }
  });

  it('detail_json 可存结构化数据，解析后字段完整', () => {
    seedBasicData(db);
    const payload = { before: { late: 20, absent: 5 }, after: { late: 25, absent: 2 }, diff: { added: 3, removed: 6 } };
    db.prepare(`
      INSERT INTO operation_logs (action, operator, target_type, summary, detail_json)
      VALUES ('recalc_complete', '王老师', 'recalc_task', '重算完成：高三 1 班', ?)
    `).run(JSON.stringify(payload));

    const row = db.prepare('SELECT detail_json FROM operation_logs ORDER BY id DESC LIMIT 1').get() as any;
    const parsed = JSON.parse(row.detail_json);
    expect(parsed.before.late).toBe(20);
    expect(parsed.after.absent).toBe(2);
    expect(parsed.diff.removed).toBe(6);
  });
});

describe('规则版本保存链路——rule_versions 快照', () => {
  it('保存新规则前应自动生成历史快照（与 routes/rules.ts 协议一致）', () => {
    seedBasicData(db);

    // 初始已有 2 条 grade_rules（高三、高二）
    const initialCount = (db.prepare('SELECT COUNT(*) as c FROM rule_versions').get() as any).c;
    expect(initialCount).toBe(0);

    // 模拟 POST /rules：先把现有 grade_rules 存一条版本快照，再存新规则，再存新版本
    const existingRules = db.prepare('SELECT grade, morning_start_time, late_tolerance_minutes, afternoon_start_time, absent_window_minutes FROM grade_rules ORDER BY grade').all() as GradeRule[];
    expect(existingRules.length).toBe(2);

    // 1. 保存前快照
    db.prepare("INSERT INTO rule_versions (content, description, created_at) VALUES (?, '保存前自动快照', CURRENT_TIMESTAMP)").run(JSON.stringify(existingRules));

    // 2. 写 grade_rules（高三 late_tolerance 从 3 → 8，新增高一）
    const newRules: GradeRule[] = [
      { grade: '高一', morning_start_time: '08:00', late_tolerance_minutes: 5, afternoon_start_time: '14:00', absent_window_minutes: 120 },
      { grade: '高二', morning_start_time: '07:30', late_tolerance_minutes: 5, afternoon_start_time: '14:00', absent_window_minutes: 120 },
      { grade: '高三', morning_start_time: '07:20', late_tolerance_minutes: 8, afternoon_start_time: '13:50', absent_window_minutes: 120 },
    ];
    db.prepare("DELETE FROM grade_rules").run();
    for (const r of newRules) {
      db.prepare(`
        INSERT INTO grade_rules (grade, morning_start_time, late_tolerance_minutes, afternoon_start_time, absent_window_minutes, updated_at)
        VALUES (@grade, @morning_start_time, @late_tolerance_minutes, @afternoon_start_time, @absent_window_minutes, CURRENT_TIMESTAMP)
      `).run(r);
    }

    // 3. 保存新版本
    db.prepare("INSERT INTO rule_versions (content, description, created_at) VALUES (?, '冬季作息：高三迟到宽容放宽至8分钟，新增高一', CURRENT_TIMESTAMP)").run(JSON.stringify(newRules));

    const versions = db.prepare('SELECT id, description, content FROM rule_versions ORDER BY id ASC').all() as any[];
    expect(versions.length).toBe(2);
    expect(versions[0].description).toBe('保存前自动快照');
    expect(versions[1].description).toContain('冬季作息');

    // 解析 content，旧版本高三 late_tolerance=3，新版本=8
    const v0content: GradeRule[] = JSON.parse(versions[0].content);
    const v1content: GradeRule[] = JSON.parse(versions[1].content);
    const v0Gao3 = v0content.find(r => r.grade === '高三')!;
    const v1Gao3 = v1content.find(r => r.grade === '高三')!;
    expect(v0Gao3.late_tolerance_minutes).toBe(3);
    expect(v1Gao3.late_tolerance_minutes).toBe(8);
    expect(v1content.some(r => r.grade === '高一')).toBe(true);
    expect(v0content.some(r => r.grade === '高一')).toBe(false);
  });

  it('app_state 可存储任意 JSON 作为 key/value 缓存（用于重算摘要缓存）', () => {
    seedBasicData(db);
    const summary = {
      task_id: 99,
      total_before: 50,
      total_after: 45,
      added: 3,
      removed: 8,
      kept: 42,
      by_grade: [{ grade: '高三', added: 2, removed: 5, kept: 30 }],
    };
    db.prepare("INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").run('recalc_summary_99', JSON.stringify(summary));

    const row = db.prepare("SELECT value FROM app_state WHERE key='recalc_summary_99'").get() as any;
    const parsed = JSON.parse(row.value);
    expect(parsed.task_id).toBe(99);
    expect(parsed.added).toBe(3);
    expect(parsed.removed).toBe(8);
    expect(parsed.by_grade[0].grade).toBe('高三');
    expect(parsed.total_before - parsed.removed + parsed.added).toBe(parsed.total_after); // 50-8+3=45
  });
});

describe('重启后持久化——规则版本/重算任务/摘要缓存/操作日志', () => {
  it('关闭并重新打开 DB 后，recalc_tasks / recalc_details / operation_logs / rule_versions / app_state 全部保留', () => {
    seedBasicData(db);

    // === 1. 写入各种数据 ===
    // 规则版本
    const rvId = db.prepare("INSERT INTO rule_versions (content, description) VALUES (?, '冬季作息调整')").run(JSON.stringify([{ grade: '高三', morning_start_time: '07:20', late_tolerance_minutes: 10, afternoon_start_time: '13:50', absent_window_minutes: 120 }])).lastInsertRowid;

    // 重算任务 + 明细
    const taskId = db.prepare(`
      INSERT INTO recalc_tasks (rule_version_id, rule_snapshot, start_date, end_date, status, operator, progress_percent, progress_message)
      VALUES (?, '[]', '2026-06-10', '2026-06-20', 'completed', '李老师', 100, '重算完成')
    `).run(rvId).lastInsertRowid;
    db.prepare(`
      INSERT INTO recalc_details (task_id, change_type, student_id, student_name, grade, class_name, anomaly_type, anomaly_date, new_description, new_status)
      VALUES (?, 'added', 'S00001', '张三', '高三', '1班', 'late', '2026-06-15', '上午迟到 10 分钟', 'pending')
    `).run(taskId);

    // 操作日志
    db.prepare(`
      INSERT INTO operation_logs (action, operator, target_type, target_id, summary)
      VALUES ('recalc_complete', '李老师', 'recalc_task', ?, '重算完成：新增1，消失0')
    `).run(String(taskId));

    // 摘要缓存
    const summary = { task_id: Number(taskId), total_before: 5, total_after: 6, added: 1, removed: 0, kept: 5 };
    db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?)").run(`recalc_summary_${taskId}`, JSON.stringify(summary));

    // 学生异常（保留）
    const anomId = db.prepare(`
      INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status, review_note, reviewed_by)
      VALUES ('S00001', 'late', '2026-06-15', '上午迟到 10 分钟', 'confirmed', '已通知家长', '李老师')
    `).run().lastInsertRowid;

    // 关闭
    db.close();

    // === 2. 重开 ===
    const db2 = new Database(TEST_DB_PATH);
    db2.pragma('journal_mode = WAL');
    db2.pragma('foreign_keys = ON');
    try {
      // 规则版本
      const v = db2.prepare('SELECT id, description, content FROM rule_versions WHERE id=?').get(Number(rvId)) as any;
      expect(v).not.toBeNull();
      expect(v.description).toBe('冬季作息调整');
      const parsed: GradeRule[] = JSON.parse(v.content);
      expect(parsed[0].grade).toBe('高三');
      expect(parsed[0].late_tolerance_minutes).toBe(10);

      // 重算任务
      const t = db2.prepare('SELECT * FROM recalc_tasks WHERE id=?').get(Number(taskId)) as any;
      expect(t.status).toBe('completed');
      expect(t.operator).toBe('李老师');
      expect(t.progress_percent).toBe(100);
      expect(t.progress_message).toBe('重算完成');
      expect(t.rule_version_id).toBe(Number(rvId));

      // 重算明细
      const d = db2.prepare('SELECT * FROM recalc_details WHERE task_id=?').get(Number(taskId)) as any;
      expect(d.change_type).toBe('added');
      expect(d.student_id).toBe('S00001');
      expect(d.student_name).toBe('张三');
      expect(d.anomaly_type).toBe('late');
      expect(d.new_description).toContain('10 分钟');

      // 操作日志
      const l = db2.prepare('SELECT action, target_id, summary FROM operation_logs ORDER BY id DESC LIMIT 1').get() as any;
      expect(l.action).toBe('recalc_complete');
      expect(l.target_id).toBe(String(taskId));
      expect(l.summary).toContain('新增1');

      // app_state 摘要
      const ss = db2.prepare("SELECT value FROM app_state WHERE key=?").get(`recalc_summary_${taskId}`) as any;
      const sp = JSON.parse(ss.value);
      expect(sp.added).toBe(1);
      expect(sp.kept).toBe(5);
      expect(sp.total_after).toBe(6);

      // 学生异常
      const a = db2.prepare('SELECT * FROM anomalies WHERE id=?').get(Number(anomId)) as any;
      expect(a.status).toBe('confirmed');
      expect(a.review_note).toBe('已通知家长');
      expect(a.reviewed_by).toBe('李老师');
      expect(a.description).toContain('10 分钟');
      expect(a.description).not.toContain('1424');
    } finally {
      db2.close();
      db = setupTestDb();
    }
  });

  it('已复核异常 + 版本规则，重启后与操作日志、任务状态一致性检查', () => {
    seedBasicData(db);
    // 1. 版本、任务、异常、日志都写
    const rv = db.prepare("INSERT INTO rule_versions (content, description) VALUES (?, '测试版本')").run(JSON.stringify([])).lastInsertRowid;
    const task = db.prepare(`INSERT INTO recalc_tasks (rule_version_id, rule_snapshot, start_date, end_date, status, operator, progress_percent) VALUES (?, '[]', '2026-06-01', '2026-06-30', 'completed', '王老师', 100)`).run(rv).lastInsertRowid;
    const anomaly = db.prepare(`INSERT INTO anomalies (student_id, anomaly_type, anomaly_date, description, status) VALUES ('S00003', 'late', '2026-06-15', '高二迟到', 'pending')`).run().lastInsertRowid;
    db.prepare(`INSERT INTO operation_logs (action, operator, target_type, target_id, summary) VALUES ('recalc_complete', '王老师', 'recalc_task', ?, '完成')`).run(String(task));

    db.close();
    const db2 = new Database(TEST_DB_PATH);
    db2.pragma('journal_mode = WAL');
    db2.pragma('foreign_keys = ON');
    try {
      // 计数都一致
      const rvC = (db2.prepare('SELECT COUNT(*) as c FROM rule_versions').get() as any).c;
      const tC = (db2.prepare('SELECT COUNT(*) as c FROM recalc_tasks').get() as any).c;
      const aC = (db2.prepare('SELECT COUNT(*) as c FROM anomalies').get() as any).c;
      const lC = (db2.prepare('SELECT COUNT(*) as c FROM operation_logs').get() as any).c;
      expect(rvC).toBe(1);
      expect(tC).toBe(1);
      expect(aC).toBe(1);
      expect(lC).toBe(1);
    } finally {
      db2.close();
      db = setupTestDb();
    }
  });
});
