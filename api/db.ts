import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'attendance.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const initSQL = `
CREATE TABLE IF NOT EXISTS students (
    student_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    grade TEXT NOT NULL,
    class_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS swipe_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    swipe_time DATETIME NOT NULL,
    device_location TEXT,
    import_batch_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(student_id)
);

CREATE TABLE IF NOT EXISTS leave_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    leave_type TEXT NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(student_id)
);

CREATE TABLE IF NOT EXISTS anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    anomaly_type TEXT NOT NULL,
    anomaly_date DATE NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    review_note TEXT,
    reviewed_by TEXT,
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(student_id)
);

CREATE TABLE IF NOT EXISTS review_histories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anomaly_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    note TEXT,
    operator TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (anomaly_id) REFERENCES anomalies(id)
);

CREATE TABLE IF NOT EXISTS grade_rules (
    grade TEXT PRIMARY KEY,
    morning_start_time TEXT NOT NULL DEFAULT '08:00',
    late_tolerance_minutes INTEGER NOT NULL DEFAULT 5,
    afternoon_start_time TEXT NOT NULL DEFAULT '14:00',
    absent_window_minutes INTEGER NOT NULL DEFAULT 120,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rule_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_swipe_unique ON swipe_records(student_id, swipe_time);
CREATE INDEX IF NOT EXISTS idx_swipe_student_time ON swipe_records(student_id, swipe_time);
CREATE INDEX IF NOT EXISTS idx_leave_student_time ON leave_records(student_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_anomaly_date ON anomalies(anomaly_date);
CREATE INDEX IF NOT EXISTS idx_anomaly_status ON anomalies(status);
CREATE INDEX IF NOT EXISTS idx_anomaly_student ON anomalies(student_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_class ON anomalies(anomaly_date, status);
`;

db.exec(initSQL);

export default db;
