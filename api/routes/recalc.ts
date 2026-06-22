import { Router } from 'express';
import {
  recalcTaskRepo,
  recalcDetailRepo,
  appStateRepo,
  operationLogRepo,
  gradeRuleRepo,
  ruleVersionRepo,
} from '../repositories';
import { acquireRecalcLock, runRecalcTask } from '../recalcEngine';
import type {
  GradeRule,
  RecalcTask,
  RecalcTaskDetail,
  RecalcSummary,
  DiffChangeType,
} from '../../shared/types';

const router = Router();

router.get('/lock-status', (_req, res) => {
  const lock = acquireRecalcLock();
  const runningOrQueued = recalcTaskRepo.getRunningOrQueued();
  res.json({
    ok: lock.ok,
    blocking_task: lock.blockingTask,
    running_or_queued: runningOrQueued,
  });
});

interface CreateTaskBody {
  rule_version_id?: number;
  start_date: string;
  end_date: string;
  operator?: string;
  rules_override?: GradeRule[];
}

router.post('/tasks', (req, res) => {
  const body = req.body as CreateTaskBody;
  const { start_date, end_date, operator, rule_version_id, rules_override } = body;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date 和 end_date 必填' });
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(start_date) || !dateRe.test(end_date)) {
    return res.status(400).json({ error: '日期格式必须为 YYYY-MM-DD' });
  }
  if (new Date(start_date + 'T00:00:00').toString() === 'Invalid Date' ||
      new Date(end_date + 'T00:00:00').toString() === 'Invalid Date') {
    return res.status(400).json({ error: '日期无效' });
  }
  if (start_date > end_date) {
    return res.status(400).json({ error: 'start_date 不能晚于 end_date' });
  }

  let rules: GradeRule[];
  let resolvedRuleVersionId: number | null = null;

  if (rules_override && Array.isArray(rules_override) && rules_override.length > 0) {
    rules = rules_override;
    resolvedRuleVersionId = rule_version_id ?? null;
  } else if (rule_version_id !== undefined && rule_version_id !== null) {
    const v = ruleVersionRepo.getById(Number(rule_version_id));
    if (!v) {
      return res.status(404).json({ error: '指定的规则版本不存在' });
    }
    rules = v.content;
    resolvedRuleVersionId = v.id;
  } else {
    rules = gradeRuleRepo.getAll();
    resolvedRuleVersionId = null;
  }

  const lock = acquireRecalcLock();
  if (!lock.ok) {
    return res.status(409).json({
      error: '已有重算任务进行中',
      blocking_task: lock.blockingTask,
    });
  }

  const taskId = recalcTaskRepo.create({
    rule_version_id: resolvedRuleVersionId,
    rule_snapshot: rules,
    start_date,
    end_date,
    operator: operator || '管理员',
  });

  operationLogRepo.create({
    action: 'recalc_start',
    operator: operator || '管理员',
    target_type: 'recalc_task',
    target_id: taskId,
    summary: `创建重算任务：${start_date} ~ ${end_date}`,
  });

  setImmediate(() => {
    runRecalcTask(taskId).catch(() => {
      // runRecalcTask 内部已经 try/catch，这里兜底防止 Promise rejection
    });
  });

  res.status(202).json({ task_id: taskId });
});

router.get('/tasks', (_req, res) => {
  res.json(recalcTaskRepo.list(50));
});

router.get('/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const task = recalcTaskRepo.getById(id);
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  const summary = appStateRepo.get<RecalcSummary>(`recalc_summary_${id}`);
  const detail: RecalcTaskDetail = {
    ...task,
    summary,
  };
  res.json(detail);
});

router.get('/tasks/:id/summary', (req, res) => {
  const id = parseInt(req.params.id);
  const task = recalcTaskRepo.getById(id);
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  const summary = appStateRepo.get<RecalcSummary>(`recalc_summary_${id}`);
  if (!summary) {
    return res.status(404).json({ error: '摘要尚未生成，请稍候' });
  }
  res.json(summary);
});

router.get('/tasks/:id/details', (req, res) => {
  const id = parseInt(req.params.id);
  const task = recalcTaskRepo.getById(id);
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  const changeType = req.query.change_type as DiffChangeType | undefined;
  const anomalyType = req.query.anomaly_type as string | undefined;
  const grade = req.query.grade as string | undefined;
  const className = req.query.class_name as string | undefined;
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.page_size as string) || 50;

  res.json(recalcDetailRepo.query(id, {
    change_type: changeType,
    anomaly_type: anomalyType,
    grade,
    class_name: className,
    page,
    page_size: pageSize,
  }));
});

router.post('/tasks/:id/cancel', (req, res) => {
  const id = parseInt(req.params.id);
  const task = recalcTaskRepo.getById(id);
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  if (task.status !== 'queued' && task.status !== 'running') {
    return res.status(400).json({ error: `当前状态(${task.status})不可取消` });
  }
  recalcTaskRepo.updateStatus(id, 'cancelled', {
    progress_message: '已手动取消',
  });
  operationLogRepo.create({
    action: 'recalc_cancel',
    operator: (req.body as { operator?: string } | undefined)?.operator || '管理员',
    target_type: 'recalc_task',
    target_id: id,
    summary: '手动取消重算任务',
  });
  res.json({ cancelled: true, task_id: id });
});

router.get('/logs', (_req, res) => {
  res.json(operationLogRepo.list(100));
});

export default router;
