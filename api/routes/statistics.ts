import { Router } from 'express';
import db from '../db';
import { appStateRepo } from '../repositories';
import type { AnomalyFilters, TrendDataPoint, DistributionDataPoint } from '../../shared/types';

const router = Router();

router.get('/trend', (req, res) => {
  const filters: AnomalyFilters = {
    grade: req.query.grade as string | undefined,
    class_name: req.query.class_name as string | undefined,
  };
  const conditions: string[] = [];
  const params: string[] = [];

  if (filters.grade) { conditions.push('s.grade = ?'); params.push(filters.grade); }
  if (filters.class_name) { conditions.push('s.class_name = ?'); params.push(filters.class_name); }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT
      a.anomaly_date as date,
      SUM(CASE WHEN a.anomaly_type = 'late' THEN 1 ELSE 0 END) as late,
      SUM(CASE WHEN a.anomaly_type = 'absent' THEN 1 ELSE 0 END) as absent,
      SUM(CASE WHEN a.anomaly_type = 'duplicate_swipe' THEN 1 ELSE 0 END) as duplicate_swipe,
      SUM(CASE WHEN a.anomaly_type = 'leave_exception' THEN 1 ELSE 0 END) as leave_exception
    FROM anomalies a
    LEFT JOIN students s ON a.student_id = s.student_id
    ${where}
    GROUP BY a.anomaly_date
    ORDER BY a.anomaly_date DESC
    LIMIT 30
  `).all(...params) as TrendDataPoint[];

  res.json(rows.reverse());
});

router.get('/distribution', (req, res) => {
  const filters: AnomalyFilters = {
    grade: req.query.grade as string | undefined,
    start_date: req.query.start_date as string | undefined,
    end_date: req.query.end_date as string | undefined,
  };
  const conditions: string[] = [];
  const params: string[] = [];

  if (filters.grade) { conditions.push('s.grade = ?'); params.push(filters.grade); }
  if (filters.start_date) { conditions.push('a.anomaly_date >= ?'); params.push(filters.start_date); }
  if (filters.end_date) { conditions.push('a.anomaly_date <= ?'); params.push(filters.end_date); }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT
      s.class_name,
      s.grade,
      COUNT(*) as count,
      SUM(CASE WHEN a.anomaly_type = 'late' THEN 1 ELSE 0 END) as late,
      SUM(CASE WHEN a.anomaly_type = 'absent' THEN 1 ELSE 0 END) as absent,
      SUM(CASE WHEN a.anomaly_type = 'duplicate_swipe' THEN 1 ELSE 0 END) as duplicate_swipe,
      SUM(CASE WHEN a.anomaly_type = 'leave_exception' THEN 1 ELSE 0 END) as leave_exception
    FROM anomalies a
    LEFT JOIN students s ON a.student_id = s.student_id
    ${where}
    GROUP BY s.grade, s.class_name
    ORDER BY s.grade, s.class_name
  `).all(...params) as Array<{
    class_name: string; grade: string; count: number;
    late: number; absent: number; duplicate_swipe: number; leave_exception: number;
  }>;

  const result: DistributionDataPoint[] = rows.map(r => ({
    class_name: r.class_name,
    grade: r.grade,
    count: r.count,
    type_breakdown: {
      late: r.late,
      absent: r.absent,
      duplicate_swipe: r.duplicate_swipe,
      leave_exception: r.leave_exception,
    },
  }));
  res.json(result);
});

router.get('/state/:key', (req, res) => {
  const v = appStateRepo.get(req.params.key);
  res.json({ value: v ?? null });
});

router.post('/state/:key', (req, res) => {
  appStateRepo.set(req.params.key, req.body.value);
  res.json({ saved: true });
});

export default router;
