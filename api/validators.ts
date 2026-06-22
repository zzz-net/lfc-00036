import { studentRepo, swipeRepo } from './repositories';
import type { ImportError, ImportValidationResult, SwipeRecord, LeaveRecord, Student } from '../shared/types';

function isValidDateTime(s: string): boolean {
  if (!s || typeof s !== 'string') return false;
  const d = new Date(s);
  return !isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100;
}

function parseDateTime(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

export function validateSwipeRecords(rows: Record<string, unknown>[]): ImportValidationResult & { validRecords: SwipeRecord[] } {
  const errors: ImportError[] = [];
  const validRecords: SwipeRecord[] = [];
  const seenCombos = new Set<string>();
  const studentsFound = new Set<string>();
  const allStudents = new Set(studentRepo.getAll().map(s => s.student_id));

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const studentId = String(row.student_id ?? row['学号'] ?? row.studentId ?? '').trim();
    const swipeTimeStr = String(row.swipe_time ?? row['刷卡时间'] ?? row.swipeTime ?? '').trim();

    if (!studentId) {
      errors.push({
        row_number: rowNumber,
        error_type: 'missing_field',
        message: '缺少学号字段',
        raw_data: row,
      });
      return;
    }

    if (!swipeTimeStr) {
      errors.push({
        row_number: rowNumber,
        student_id: studentId,
        error_type: 'missing_field',
        message: '缺少刷卡时间字段',
        raw_data: row,
      });
      return;
    }

    if (!isValidDateTime(swipeTimeStr)) {
      errors.push({
        row_number: rowNumber,
        student_id: studentId,
        error_type: 'invalid_time',
        message: `非法时间格式: ${swipeTimeStr}`,
        raw_data: row,
      });
      return;
    }

    const swipeDate = parseDateTime(swipeTimeStr)!;
    if (swipeDate.getHours() < 5 || swipeDate.getHours() > 23) {
      errors.push({
        row_number: rowNumber,
        student_id: studentId,
        error_type: 'invalid_time',
        message: `非法时间段（不在 05:00-23:00）: ${swipeTimeStr}`,
        raw_data: row,
      });
      return;
    }

    if (!allStudents.has(studentId)) {
      errors.push({
        row_number: rowNumber,
        student_id: studentId,
        error_type: 'unknown_student',
        message: `未知学生学号: ${studentId}`,
        raw_data: row,
      });
      return;
    }

    const comboKey = `${studentId}__${swipeTimeStr}`;
    if (seenCombos.has(comboKey)) {
      errors.push({
        row_number: rowNumber,
        student_id: studentId,
        error_type: 'duplicate_record',
        message: `同一批次内重复刷卡记录: ${studentId} @ ${swipeTimeStr}`,
        raw_data: row,
      });
      return;
    }
    seenCombos.add(comboKey);

    const isoTime = swipeDate.toISOString();
    if (swipeRepo.existsDuplicate(studentId, isoTime)) {
      errors.push({
        row_number: rowNumber,
        student_id: studentId,
        error_type: 'duplicate_record',
        message: `数据库中已存在相同刷卡记录: ${studentId} @ ${swipeTimeStr}`,
        raw_data: row,
      });
      return;
    }

    studentsFound.add(studentId);
    validRecords.push({
      student_id: studentId,
      swipe_time: isoTime,
      device_location: row.device_location ? String(row.device_location) : undefined,
    });
  });

  return {
    valid_records: validRecords.length,
    validRecords,
    errors,
    students_found: Array.from(studentsFound),
  };
}

export function validateLeaveRecords(rows: Record<string, unknown>[]): ImportValidationResult & { validRecords: LeaveRecord[] } {
  const errors: ImportError[] = [];
  const validRecords: LeaveRecord[] = [];
  const studentsFound = new Set<string>();
  const allStudents = new Set(studentRepo.getAll().map(s => s.student_id));
  const validLeaveTypes = new Set(['sick', 'personal', 'official', 'other', '病假', '事假', '公假', '其他']);

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const studentId = String(row.student_id ?? row['学号'] ?? row.studentId ?? '').trim();
    const startTimeStr = String(row.start_time ?? row['开始时间'] ?? row.startTime ?? '').trim();
    const endTimeStr = String(row.end_time ?? row['结束时间'] ?? row.endTime ?? '').trim();
    const leaveType = String(row.leave_type ?? row['请假类型'] ?? row.leaveType ?? 'other').trim();

    if (!studentId) {
      errors.push({
        row_number: rowNumber,
        error_type: 'missing_field',
        message: '缺少学号字段',
        raw_data: row,
      });
      return;
    }

    if (!startTimeStr || !endTimeStr) {
      errors.push({
        row_number: rowNumber,
        student_id: studentId,
        error_type: 'missing_field',
        message: '缺少请假开始或结束时间',
        raw_data: row,
      });
      return;
    }

    if (!isValidDateTime(startTimeStr) || !isValidDateTime(endTimeStr)) {
      errors.push({
        row_number: rowNumber,
        student_id: studentId,
        error_type: 'invalid_time',
        message: `非法时间格式: ${startTimeStr} ~ ${endTimeStr}`,
        raw_data: row,
      });
      return;
    }

    const start = parseDateTime(startTimeStr)!;
    const end = parseDateTime(endTimeStr)!;
    if (end.getTime() <= start.getTime()) {
      errors.push({
        row_number: rowNumber,
        student_id: studentId,
        error_type: 'invalid_time',
        message: `结束时间必须晚于开始时间: ${startTimeStr} ~ ${endTimeStr}`,
        raw_data: row,
      });
      return;
    }

    if (!allStudents.has(studentId)) {
      errors.push({
        row_number: rowNumber,
        student_id: studentId,
        error_type: 'unknown_student',
        message: `未知学生学号: ${studentId}`,
        raw_data: row,
      });
      return;
    }

    let normalizedType = leaveType;
    if (leaveType === '病假') normalizedType = 'sick';
    else if (leaveType === '事假') normalizedType = 'personal';
    else if (leaveType === '公假') normalizedType = 'official';
    else if (leaveType === '其他') normalizedType = 'other';

    if (!validLeaveTypes.has(normalizedType)) {
      normalizedType = 'other';
    }

    studentsFound.add(studentId);
    validRecords.push({
      student_id: studentId,
      leave_type: normalizedType,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      reason: row.reason ? String(row.reason) : undefined,
    });
  });

  return {
    valid_records: validRecords.length,
    validRecords,
    errors,
    students_found: Array.from(studentsFound),
  };
}

export function validateStudentRecords(rows: Record<string, unknown>[]): ImportValidationResult & { validRecords: Student[] } {
  const errors: ImportError[] = [];
  const validRecords: Student[] = [];
  const seenIds = new Set<string>();

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const studentId = String(row.student_id ?? row['学号'] ?? row.studentId ?? '').trim();
    const name = String(row.name ?? row['姓名'] ?? '').trim();
    const grade = String(row.grade ?? row['年级'] ?? '').trim();
    const className = String(row.class_name ?? row['班级'] ?? row.className ?? '').trim();

    if (!studentId || !name || !grade || !className) {
      errors.push({
        row_number: rowNumber,
        student_id: studentId || undefined,
        error_type: 'missing_field',
        message: '缺少学号/姓名/年级/班级字段',
        raw_data: row,
      });
      return;
    }

    if (seenIds.has(studentId)) {
      errors.push({
        row_number: rowNumber,
        student_id: studentId,
        error_type: 'duplicate_record',
        message: `重复的学号: ${studentId}`,
        raw_data: row,
      });
      return;
    }
    seenIds.add(studentId);

    validRecords.push({ student_id: studentId, name, grade, class_name: className });
  });

  return {
    valid_records: validRecords.length,
    validRecords,
    errors,
    students_found: validRecords.map(s => s.student_id),
  };
}
