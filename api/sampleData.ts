import {
  studentRepo,
  swipeRepo,
  leaveRepo,
  anomalyRepo,
  gradeRuleRepo,
} from './repositories';
import type { Student, SwipeRecord, LeaveRecord, GradeRule } from '../shared/types';
import { autoDetectFromExistingData } from './anomalyEngine';

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export function loadSampleData(): {
  students: number;
  swipeRecords: number;
  leaveRecords: number;
  anomalies: number;
  dateRange: { start: string; end: string } | null;
} {
  anomalyRepo.clearAll();
  swipeRepo.clearAll();
  leaveRepo.clearAll();

  const grades = ['高一', '高二', '高三'];
  const classesPerGrade = 3;
  const studentsPerClass = 8;

  const surnames = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '胡', '朱', '高', '林'];
  const givenNames = ['伟', '芳', '娜', '敏', '静', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀英', '霞'];

  const students: Student[] = [];
  let sidCounter = 1;

  for (const grade of grades) {
    for (let c = 1; c <= classesPerGrade; c++) {
      const className = `${c}班`;
      for (let s = 0; s < studentsPerClass; s++) {
        const surname = surnames[Math.floor(Math.random() * surnames.length)];
        const given = givenNames[Math.floor(Math.random() * givenNames.length)];
        const studentId = `S${String(sidCounter).padStart(5, '0')}`;
        students.push({
          student_id: studentId,
          name: surname + given,
          grade,
          class_name: className,
        });
        sidCounter++;
      }
    }
  }

  studentRepo.bulkUpsert(students);

  const defaultRules: GradeRule[] = [
    { grade: '高一', morning_start_time: '07:40', late_tolerance_minutes: 5, afternoon_start_time: '14:00', absent_window_minutes: 120 },
    { grade: '高二', morning_start_time: '07:30', late_tolerance_minutes: 5, afternoon_start_time: '14:00', absent_window_minutes: 120 },
    { grade: '高三', morning_start_time: '07:20', late_tolerance_minutes: 3, afternoon_start_time: '13:50', absent_window_minutes: 120 },
  ];
  gradeRuleRepo.clearAll();
  gradeRuleRepo.saveAll(defaultRules);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const swipeRecords: SwipeRecord[] = [];
  const leaveRecords: LeaveRecord[] = [];

  for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
    const day = new Date(today);
    day.setDate(day.getDate() - dayOffset);
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue;

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      const rule = defaultRules.find(r => r.grade === student.grade) || defaultRules[0];
      const morningHH = parseInt(rule.morning_start_time.split(':')[0]);
      const morningMM = parseInt(rule.morning_start_time.split(':')[1]);
      const afternoonHH = parseInt(rule.afternoon_start_time.split(':')[0]);
      const afternoonMM = parseInt(rule.afternoon_start_time.split(':')[1]);

      const rand = Math.random();
      let skipMorning = false;
      let skipAfternoon = false;
      let lateMorning = false;
      let lateAfternoon = false;
      let isOnLeave = false;

      if (rand < 0.05) {
        isOnLeave = true;
      } else if (rand < 0.10) {
        skipMorning = true;
      } else if (rand < 0.13) {
        skipAfternoon = true;
      } else if (rand < 0.22) {
        lateMorning = true;
      } else if (rand < 0.30) {
        lateAfternoon = true;
      }

      if (isOnLeave) {
        const leaveStart = new Date(day);
        leaveStart.setHours(8, 0, 0, 0);
        const leaveEnd = new Date(day);
        leaveEnd.setHours(17, 0, 0, 0);
        const leaveTypes = ['sick', 'personal', 'official'];
        leaveRecords.push({
          student_id: student.student_id,
          leave_type: leaveTypes[Math.floor(Math.random() * leaveTypes.length)],
          start_time: isoDate(leaveStart),
          end_time: isoDate(leaveEnd),
          reason: ['身体不适', '家中有事', '校外活动'][Math.floor(Math.random() * 3)],
        });

        if (Math.random() < 0.4) {
          const t = new Date(day);
          t.setHours(10, Math.floor(Math.random() * 60), 0, 0);
          swipeRecords.push({
            student_id: student.student_id,
            swipe_time: t.toISOString(),
            device_location: '校门口',
          });
        }
        continue;
      }

      if (!skipMorning) {
        const t = new Date(day);
        let h = morningHH;
        let m = morningMM;
        if (lateMorning) {
          m += rule.late_tolerance_minutes + Math.floor(Math.random() * 30) + 1;
        } else {
          m -= Math.floor(Math.random() * 15);
          if (m < 0) { h -= 1; m += 60; }
        }
        t.setHours(h, m, 0, 0);
        swipeRecords.push({
          student_id: student.student_id,
          swipe_time: t.toISOString(),
          device_location: '校门口',
        });

        if (Math.random() < 0.05) {
          const t2 = new Date(t);
          t2.setSeconds(t2.getSeconds() + 20);
          swipeRecords.push({
            student_id: student.student_id,
            swipe_time: t2.toISOString(),
            device_location: '校门口',
          });
        }
      }

      if (!skipAfternoon) {
        const t = new Date(day);
        let h = afternoonHH;
        let m = afternoonMM;
        if (lateAfternoon) {
          m += rule.late_tolerance_minutes + Math.floor(Math.random() * 30) + 1;
        } else {
          m -= Math.floor(Math.random() * 15);
          if (m < 0) { h -= 1; m += 60; }
        }
        t.setHours(h, m, 0, 0);
        swipeRecords.push({
          student_id: student.student_id,
          swipe_time: t.toISOString(),
          device_location: '校门口',
        });
      }
    }
  }

  swipeRepo.bulkInsert(swipeRecords);
  leaveRepo.bulkInsert(leaveRecords);

  const result = autoDetectFromExistingData();

  return {
    students: students.length,
    swipeRecords: swipeRecords.length,
    leaveRecords: leaveRecords.length,
    anomalies: result.total,
    dateRange: result.dateRange,
  };
}
