import {
  anomalyRepo,
  recalcTaskRepo,
  recalcDetailRepo,
  appStateRepo,
  operationLogRepo,
  studentRepo,
} from './repositories';
import { detectAnomaliesForDateWithRules } from './anomalyEngine';
import db from './db';
import type {
  Anomaly,
  AnomalyType,
  AnomalyStatus,
  GradeRule,
  RecalcTask,
  RecalcDetailItem,
  DiffChangeType,
  Student,
} from '../shared/types';

interface PendingAnomaly {
  student_id: string;
  anomaly_type: AnomalyType;
  anomaly_date: string;
  description?: string;
  status: 'pending';
}

interface OldAnomalySnapshot {
  id: number;
  anomaly_type: AnomalyType;
  anomaly_date: string;
  description: string | undefined;
  status: AnomalyStatus;
  student_id: string;
  student_name?: string;
  grade?: string;
  class_name?: string;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function detectAnomaliesInRangeWithRules(
  startDate: string,
  endDate: string,
  rules: GradeRule[],
  reviewedKeys: Set<string>,
): PendingAnomaly[] {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  const all: PendingAnomaly[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = toDateStr(d);
    const anomalies = detectAnomaliesForDateWithRules(dateStr, rules);
    for (const a of anomalies) {
      all.push({
        student_id: a.student_id,
        anomaly_type: a.anomaly_type,
        anomaly_date: a.anomaly_date,
        description: a.description,
        status: 'pending',
      });
    }
  }

  return all.filter(a => !reviewedKeys.has(`${a.student_id}__${a.anomaly_type}__${a.anomaly_date}`));
}

function getAnomaliesInRangeWithStudents(startDate: string, endDate: string): OldAnomalySnapshot[] {
  const rows = db.prepare(`
    SELECT
      a.id,
      a.student_id,
      a.anomaly_type,
      a.anomaly_date,
      a.description,
      a.status,
      s.name as student_name,
      s.grade,
      s.class_name
    FROM anomalies a
    LEFT JOIN students s ON a.student_id = s.student_id
    WHERE a.anomaly_date >= ? AND a.anomaly_date <= ?
    ORDER BY a.anomaly_date DESC
  `).all(startDate, endDate) as Array<{
    id: number;
    student_id: string;
    anomaly_type: string;
    anomaly_date: string;
    description?: string;
    status: string;
    student_name?: string;
    grade?: string;
    class_name?: string;
  }>;

  return rows.map(r => ({
    id: r.id,
    student_id: r.student_id,
    anomaly_type: r.anomaly_type as AnomalyType,
    anomaly_date: r.anomaly_date,
    description: r.description,
    status: r.status as AnomalyStatus,
    student_name: r.student_name,
    grade: r.grade,
    class_name: r.class_name,
  }));
}

export function acquireRecalcLock(): { ok: boolean; blockingTask?: RecalcTask } {
  const runningOrQueued = recalcTaskRepo.getRunningOrQueued();
  if (runningOrQueued.length > 0) {
    return { ok: false, blockingTask: runningOrQueued[0] };
  }
  return { ok: true };
}

function enrichPendingWithStudentInfo(
  pending: PendingAnomaly[],
): Array<PendingAnomaly & { student_name?: string; grade?: string; class_name?: string }> {
  const students = studentRepo.getAll();
  const studentMap = new Map<string, Student>();
  students.forEach(s => studentMap.set(s.student_id, s));

  return pending.map(p => {
    const s = studentMap.get(p.student_id);
    return {
      ...p,
      student_name: s?.name,
      grade: s?.grade,
      class_name: s?.class_name,
    };
  });
}

function isCancelled(taskId: number): boolean {
  const t = recalcTaskRepo.getById(taskId);
  return t?.status === 'cancelled';
}

export async function runRecalcTask(taskId: number): Promise<void> {
  try {
    const task = recalcTaskRepo.getById(taskId);
    if (!task) return;

    const othersRunning = recalcTaskRepo.getRunningOrQueued().filter(t => t.id !== taskId);
    if (othersRunning.length > 0) {
      recalcTaskRepo.updateStatus(taskId, 'failed', {
        error_message: '检测到其他重算任务正在运行，已取消本次执行',
        progress_percent: 0,
      });
      operationLogRepo.create({
        action: 'recalc_failed',
        operator: task.operator,
        target_type: 'recalc_task',
        target_id: taskId,
        summary: '重算失败：检测到冲突任务',
      });
      return;
    }

    recalcTaskRepo.updateStatus(taskId, 'running', {
      progress_percent: 5,
      progress_message: '采集重算前快照...',
    });

    if (isCancelled(taskId)) return;

    const oldAnomalies = getAnomaliesInRangeWithStudents(task.start_date, task.end_date);
    const oldMap = new Map<string, OldAnomalySnapshot>();
    for (const a of oldAnomalies) {
      const key = `${a.student_id}__${a.anomaly_type}__${a.anomaly_date}`;
      oldMap.set(key, a);
    }
    const totalBefore = oldMap.size;

    if (isCancelled(taskId)) return;

    const reviewedKeys = anomalyRepo.getReviewedKeys();

    recalcTaskRepo.updateStatus(taskId, 'running', {
      progress_percent: 15,
      progress_message: '用新规则重新检测异常...',
    });

    const newPending = detectAnomaliesInRangeWithRules(
      task.start_date,
      task.end_date,
      task.rule_snapshot,
      reviewedKeys,
    );

    const newEnriched = enrichPendingWithStudentInfo(newPending);

    type NewRecord = {
      anomaly_type: AnomalyType;
      anomaly_date: string;
      description: string | undefined;
      status: AnomalyStatus;
      student_id: string;
      student_name?: string;
      grade?: string;
      class_name?: string;
    };

    const newMap = new Map<string, NewRecord>();
    for (const a of newEnriched) {
      const key = `${a.student_id}__${a.anomaly_type}__${a.anomaly_date}`;
      newMap.set(key, {
        anomaly_type: a.anomaly_type,
        anomaly_date: a.anomaly_date,
        description: a.description,
        status: a.status,
        student_id: a.student_id,
        student_name: a.student_name,
        grade: a.grade,
        class_name: a.class_name,
      });
    }
    const totalAfter = newMap.size;

    recalcTaskRepo.updateStatus(taskId, 'running', {
      progress_percent: 30,
      progress_message: '计算差异...',
    });

    if (isCancelled(taskId)) return;

    const allKeys = new Set<string>([...oldMap.keys(), ...newMap.keys()]);
    const details: Array<Omit<RecalcDetailItem, 'id'>> = [];

    let addedCount = 0;
    let removedCount = 0;

    for (const key of allKeys) {
      const oldRec = oldMap.get(key);
      const newRec = newMap.get(key);

      if (newRec && !oldRec) {
        addedCount++;
        details.push({
          task_id: taskId,
          change_type: 'added',
          student_id: newRec.student_id,
          student_name: newRec.student_name,
          grade: newRec.grade,
          class_name: newRec.class_name,
          anomaly_type: newRec.anomaly_type,
          anomaly_date: newRec.anomaly_date,
          new_description: newRec.description,
          new_status: newRec.status,
        });
      } else if (oldRec && !newRec) {
        removedCount++;
        details.push({
          task_id: taskId,
          change_type: 'removed',
          student_id: oldRec.student_id,
          student_name: oldRec.student_name,
          grade: oldRec.grade,
          class_name: oldRec.class_name,
          anomaly_type: oldRec.anomaly_type,
          anomaly_date: oldRec.anomaly_date,
          old_description: oldRec.description,
          old_status: oldRec.status,
          old_anomaly_id: oldRec.id,
        });
      } else if (oldRec && newRec) {
        const descChanged = oldRec.description !== newRec.description;
        const statusChanged = oldRec.status !== newRec.status;
        const changeType: DiffChangeType = (descChanged || statusChanged) ? 'kept_modified' : 'kept';
        details.push({
          task_id: taskId,
          change_type: changeType,
          student_id: oldRec.student_id,
          student_name: oldRec.student_name,
          grade: oldRec.grade,
          class_name: oldRec.class_name,
          anomaly_type: oldRec.anomaly_type,
          anomaly_date: oldRec.anomaly_date,
          old_description: oldRec.description,
          new_description: newRec.description,
          old_status: oldRec.status,
          new_status: newRec.status,
          old_anomaly_id: oldRec.id,
        });
      }
    }

    recalcTaskRepo.updateStatus(taskId, 'running', {
      progress_percent: 70,
      progress_message: '写入差异明细...',
    });

    if (isCancelled(taskId)) return;

    recalcDetailRepo.bulkInsert(details);

    recalcTaskRepo.updateStatus(taskId, 'running', {
      progress_percent: 90,
      progress_message: '生成摘要...',
    });

    if (isCancelled(taskId)) return;

    const summary = recalcDetailRepo.computeSummary(taskId, totalBefore, totalAfter);
    appStateRepo.set(`recalc_summary_${taskId}`, summary);

    recalcTaskRepo.updateStatus(taskId, 'completed', {
      progress_percent: 100,
      progress_message: '重算完成',
    });

    operationLogRepo.create({
      action: 'recalc_complete',
      operator: task.operator,
      target_type: 'recalc_task',
      target_id: taskId,
      summary: `重算完成（新增${addedCount}，消失${removedCount}）`,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    try {
      const task = recalcTaskRepo.getById(taskId);
      recalcTaskRepo.updateStatus(taskId, 'failed', {
        error_message: errorMessage,
      });
      if (task) {
        operationLogRepo.create({
          action: 'recalc_failed',
          operator: task.operator,
          target_type: 'recalc_task',
          target_id: taskId,
          summary: `重算失败：${errorMessage}`,
        });
      }
    } catch (_e) {
      // ignore cleanup errors
    }
  }
}
