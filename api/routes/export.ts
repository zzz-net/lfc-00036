import { Router } from 'express';
import { exportAnomaliesCsv, exportSummaryCsv } from '../exporters';
import type { AnomalyFilters } from '../../shared/types';

const router = Router();

router.get('/anomalies', (req, res) => {
  const filters: AnomalyFilters = {
    grade: req.query.grade as string | undefined,
    class_name: req.query.class_name as string | undefined,
    anomaly_type: req.query.anomaly_type as AnomalyFilters['anomaly_type'],
    status: req.query.status as AnomalyFilters['status'],
    start_date: req.query.start_date as string | undefined,
    end_date: req.query.end_date as string | undefined,
  };
  const csv = exportAnomaliesCsv(filters);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="anomalies_${Date.now()}.csv"`);
  res.send(csv);
});

router.get('/summary', (req, res) => {
  const filters: AnomalyFilters = {
    grade: req.query.grade as string | undefined,
    class_name: req.query.class_name as string | undefined,
    start_date: req.query.start_date as string | undefined,
    end_date: req.query.end_date as string | undefined,
  };
  const csv = exportSummaryCsv(filters);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="summary_${Date.now()}.csv"`);
  res.send(csv);
});

export default router;
