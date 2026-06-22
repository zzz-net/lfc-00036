import {
  studentRepo,
  swipeRepo,
  leaveRepo,
  anomalyRepo,
  gradeRuleRepo,
} from './repositories';
import db from './db';
import type { Anomaly, AnomalyType, GradeRule, LeaveRecord, SwipeRecord } from '../shared/types';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseTime(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { h, m };
}

function isLeaveCovers(leaves: LeaveRecord[], date: string, morningOnly = false, afternoonOnly = false): boolean {
  const targetDate = new Date(date + 'T00:00:00');
  for (const lv of leaves) {
    const start = new Date(lv.start_time);
    const end = new Date(lv.end_time);
    const startDay = new Date(start); startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(end); endDay.setHours(0, 0, 0, 0);

    if (targetDate < startDay || targetDate > endDay) continue;

    if (morningOnly) {
      const morningEnd = new Date(targetDate); morningEnd.setHours(12, 0, 0, 0);
      if (start <= morningEnd) return true;
    } else if (afternoonOnly) {
      const afternoonStart = new Date(targetDate); afternoonStart.setHours(12, 0, 0, 0);
      if (end >= afternoonStart) return true;
    } else {
      return true;
    }
  }
  return false;
}

const LEAVE_TYPES_THAT_COVER = new Set(['sick', 'personal', 'official', '病假', '事假', '公假']);

function filterCoveringLeaves(leaves: LeaveRecord[]): LeaveRecord[] {
  return leaves.filter(lv => LEAVE_TYPES_THAT_COVER.has(String(lv.leave_type)));
}

export function detectAnomaliesForDate(date: string): Array<Omit<Anomaly, 'id' | 'created_at'>> {
  const results: Array<Omit<Anomaly, 'id' | 'created_at'>> = [];
  const students = studentRepo.getAll();
  const allRules = gradeRuleRepo.getAll();
  const ruleMap = new Map<string, GradeRule>();
  allRules.forEach(r => ruleMap.set(r.grade, r));

  const defaultRule: GradeRule = {
    grade: '__default',
    morning_start_time: '08:00',
    late_tolerance_minutes: 5,
    afternoon_start_time: '14:00',
    absent_window_minutes: 120,
  };

  for (const student of students) {
    const rule = ruleMap.get(student.grade) || defaultRule;
    const swipes = swipeRepo.getByStudentAndDate(student.student_id, date);
    const leaves = filterCoveringLeaves(leaveRepo.getByStudentAndDate(student.student_id, date));

    const morningStart = parseTime(rule.morning_start_time);
    const morningDeadline = new Date(date + 'T00:00:00');
    morningDeadline.setHours(morningStart.h, morningStart.m + rule.late_tolerance_minutes, 0, 0);

    const afternoonStart = parseTime(rule.afternoon_start_time);
    const afternoonDeadline = new Date(date + 'T00:00:00');
    afternoonDeadline.setHours(afternoonStart.h, afternoonStart.m + rule.late_tolerance_minutes, 0, 0);

    const absentWindowMs = rule.absent_window_minutes * 60 * 1000;

    const morningSwipes = swipes.filter(s => {
      const t = new Date(s.swipe_time);
      return t.getHours() < 12;
    });
    const afternoonSwipes = swipes.filter(s => {
      const t = new Date(s.swipe_time);
      return t.getHours() >= 12;
    });

    const firstMorningSwipe = morningSwipes[0];
    const firstAfternoonSwipe = afternoonSwipes[0];

    // 重复刷卡检测
    const seenMinutes = new Map<string, SwipeRecord>();
    for (const sw of swipes) {
      const t = new Date(sw.swipe_time);
      const minuteKey = `${t.getHours()}-${t.getMinutes()}`;
      if (seenMinutes.has(minuteKey)) {
        const prev = seenMinutes.get(minuteKey)!;
        if (Math.abs(new Date(sw.swipe_time).getTime() - new Date(prev.swipe_time).getTime()) < 60 * 1000) {
          results.push({
            student_id: student.student_id,
            anomaly_type: 'duplicate_swipe' as AnomalyType,
            anomaly_date: date,
            description: `1分钟内重复刷卡：${prev.swipe_time.slice(11, 19)} 与 ${sw.swipe_time.slice(11, 19)}`,
            status: 'pending',
          });
          continue;
        }
      }
      seenMinutes.set(minuteKey, sw);
    }

    // 上午迟到
    if (firstMorningSwipe) {
      const swipeT = new Date(firstMorningSwipe.swipe_time);
      if (swipeT > morningDeadline && !isLeaveCovers(leaves, date, true, false)) {
        const lateMinutes = Math.round((swipeT.getTime() - morningDeadline.getTime()) / 60000);
        results.push({
          student_id: student.student_id,
          anomaly_type: 'late' as AnomalyType,
          anomaly_date: date,
          description: `上午迟到 ${lateMinutes} 分钟，首次刷卡 ${firstMorningSwipe.swipe_time.slice(11, 19)}`,
          status: 'pending',
        });
      }
    }

    // 下午迟到
    if (firstAfternoonSwipe) {
      const swipeT = new Date(firstAfternoonSwipe.swipe_time);
      if (swipeT > afternoonDeadline && !isLeaveCovers(leaves, date, false, true)) {
        const lateMinutes = Math.round((swipeT.getTime() - afternoonDeadline.getTime()) / 60000);
        results.push({
          student_id: student.student_id,
          anomaly_type: 'late' as AnomalyType,
          anomaly_date: date,
          description: `下午迟到 ${lateMinutes} 分钟，首次刷卡 ${firstAfternoonSwipe.swipe_time.slice(11, 19)}`,
          status: 'pending',
        });
      }
    }

    // 上午缺勤（上午无刷卡且未请假）
    if (morningSwipes.length === 0 && !isLeaveCovers(leaves, date, true, false)) {
      const dayOfWeek = new Date(date).getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        results.push({
          student_id: student.student_id,
          anomaly_type: 'absent' as AnomalyType,
          anomaly_date: date,
          description: '上午缺勤：无刷卡记录且无有效请假',
          status: 'pending',
        });
      }
    }

    // 下午缺勤（下午无刷卡且未请假）
    if (afternoonSwipes.length === 0 && !isLeaveCovers(leaves, date, false, true)) {
      const dayOfWeek = new Date(date).getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        results.push({
          student_id: student.student_id,
          anomaly_type: 'absent' as AnomalyType,
          anomaly_date: date,
          description: '下午缺勤：无刷卡记录且无有效请假',
          status: 'pending',
        });
      }
    }

    // 请假例外：有请假但也出现异常刷卡（请假期间刷卡）
    if (leaves.length > 0) {
      for (const sw of swipes) {
        const swT = new Date(sw.swipe_time);
        for (const lv of leaves) {
          const lvS = new Date(lv.start_time);
          const lvE = new Date(lv.end_time);
          if (swT >= lvS && swT <= lvE) {
            results.push({
              student_id: student.student_id,
              anomaly_type: 'leave_exception' as AnomalyType,
              anomaly_date: date,
              description: `请假期间出现刷卡记录：${sw.swipe_time.slice(11, 19)}（请假 ${lv.start_time.slice(11, 19)} - ${lv.end_time.slice(11, 19)}）`,
              status: 'pending',
            });
          }
        }
      }
    }
  }

  return results;
}

export function detectAnomaliesInRange(startDate: string, endDate: string): number {
  anomalyRepo.clearAll();
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  let total = 0;

  const all: Array<Omit<Anomaly, 'id' | 'created_at'>> = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = toDateStr(d);
    const anomalies = detectAnomaliesForDate(dateStr);
    all.push(...anomalies);
  }

  if (all.length > 0) {
    anomalyRepo.bulkInsert(all);
    total = all.length;
  }
  return total;
}

export function autoDetectFromExistingData(): { total: number; dateRange: { start: string; end: string } | null } {
  const rows = db.prepare(
    "SELECT MIN(DATE(swipe_time)) as min_date, MAX(DATE(swipe_time)) as max_date FROM swipe_records"
  ).get() as { min_date: string | null; max_date: string | null };

  if (!rows.min_date || !rows.max_date) {
    return { total: 0, dateRange: null };
  }

  const total = detectAnomaliesInRange(rows.min_date, rows.max_date);
  return { total, dateRange: { start: rows.min_date, end: rows.max_date } };
}
