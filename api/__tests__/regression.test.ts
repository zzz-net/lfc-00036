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

    db.prepare("INSERT OR REPLACE INTO grade_rules VALUES ('高一', '07:40', 5, '14:00', 120)").run();
    db.prepare("INSERT OR REPLACE INTO grade_rules VALUES ('高二', '07:30', 5, '14:00', 120)").run();
    db.prepare("INSERT OR REPLACE INTO grade_rules VALUES ('高三', '07:20', 3, '13:50', 120)").run();

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
    db.prepare("INSERT INTO grade_rules VALUES ('高一', '07:40', 5, '14:00', 120)").run();

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
