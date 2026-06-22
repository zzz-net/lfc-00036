import { Router } from 'express';
import { exportAnomaliesCsv, exportSummaryCsv, exportRecalcDiffCsv, exportRecalcSummaryCsv } from '../exporters';
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

router.get('/recalc/:id/diff', (req, res) => {
  const id = parseInt(req.params.id);
  const csv = exportRecalcDiffCsv(id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="recalc_${id}_diff_${Date.now()}.csv"`);
  res.send(csv);
});

router.get('/recalc/:id/summary', (req, res) => {
  const id = parseInt(req.params.id);
  const csv = exportRecalcSummaryCsv(id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="recalc_${id}_summary_${Date.now()}.csv"`);
  res.send(csv);
});

export default router;
