import { Router } from 'express';
import { anomalyRepo, reviewHistoryRepo, swipeRepo, leaveRepo } from '../repositories';
import { autoDetectFromExistingData, detectAnomaliesInRange } from '../anomalyEngine';
import type { AnomalyFilters, AnomalyStatus } from '../../shared/types';

const router = Router();

router.get('/', (req, res) => {
  const filters: AnomalyFilters = {
    grade: req.query.grade as string | undefined,
    class_name: req.query.class_name as string | undefined,
    anomaly_type: req.query.anomaly_type as AnomalyFilters['anomaly_type'],
    status: req.query.status as AnomalyFilters['status'],
    start_date: req.query.start_date as string | undefined,
    end_date: req.query.end_date as string | undefined,
    page: parseInt(req.query.page as string) || 1,
    page_size: parseInt(req.query.page_size as string) || 20,
  };
  res.json(anomalyRepo.query(filters));
});

router.get('/counts', (_req, res) => {
  res.json(anomalyRepo.getCountsByStatus());
});

router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const anomaly = anomalyRepo.getById(id);
  if (!anomaly) {
    return res.status(404).json({ error: '异常记录不存在' });
  }
  const swipes = anomaly.student ? swipeRepo.getByStudentAndDate(anomaly.student_id, anomaly.anomaly_date) : [];
  const leaves = anomaly.student ? leaveRepo.getByStudentAndDate(anomaly.student_id, anomaly.anomaly_date) : [];
  const history = reviewHistoryRepo.getByAnomalyId(id);
  res.json({ anomaly, swipes, leaves, history });
});

router.get('/:id/history', (req, res) => {
  const id = parseInt(req.params.id);
  res.json(reviewHistoryRepo.getByAnomalyId(id));
});

router.post('/:id/review', (req, res) => {
  const id = parseInt(req.params.id);
  const { note, action, operator = '管理员' } = req.body as { note?: string; action?: string; operator?: string };
  const anomaly = anomalyRepo.getById(id);
  if (!anomaly) {
    return res.status(404).json({ error: '异常记录不存在' });
  }
  let newStatus: AnomalyStatus = 'confirmed';
  let actionType: 'review' | 'revert' | 'dismiss' = 'review';
  if (action === 'dismiss') {
    newStatus = 'dismissed';
    actionType = 'dismiss';
  } else if (action === 'revert') {
    newStatus = 'reverted';
    actionType = 'revert';
  }
  const oldStatus = anomaly.status;
  anomalyRepo.updateStatus(id, newStatus, note, operator);
  reviewHistoryRepo.insert({
    anomaly_id: id,
    action: actionType,
    old_status: oldStatus,
    new_status: newStatus,
    note,
    operator,
  });
  res.json({ id, status: newStatus });
});

router.post('/:id/revert', (req, res) => {
  const id = parseInt(req.params.id);
  const { note, operator = '管理员' } = req.body as { note?: string; operator?: string };
  const anomaly = anomalyRepo.getById(id);
  if (!anomaly) {
    return res.status(404).json({ error: '异常记录不存在' });
  }
  const oldStatus = anomaly.status;
  anomalyRepo.updateStatus(id, 'reverted', note, operator);
  reviewHistoryRepo.insert({
    anomaly_id: id,
    action: 'revert',
    old_status: oldStatus,
    new_status: 'reverted',
    note,
    operator,
  });
  res.json({ id, status: 'reverted' });
});

router.post('/redetect', (req, res) => {
  const { start_date, end_date } = req.body as { start_date?: string; end_date?: string };
  let total: number;
  if (start_date && end_date) {
    total = detectAnomaliesInRange(start_date, end_date);
    res.json({ total, start_date, end_date });
  } else {
    const r = autoDetectFromExistingData();
    res.json({ total: r.total, date_range: r.dateRange });
  }
});

export default router;
