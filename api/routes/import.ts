import { Router } from 'express';
import { swipeRepo, leaveRepo } from '../repositories';
import { validateSwipeRecords, validateLeaveRecords } from '../validators';
import { autoDetectFromExistingData } from '../anomalyEngine';
import { loadSampleData } from '../sampleData';
import db from '../db';

const router = Router();

router.post('/validate/swipes', (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  const result = validateSwipeRecords(rows);
  res.json({
    valid_records: result.valid_records,
    errors: result.errors,
    students_found: result.students_found,
  });
});

router.post('/validate/leaves', (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  const result = validateLeaveRecords(rows);
  res.json({
    valid_records: result.valid_records,
    errors: result.errors,
    students_found: result.students_found,
  });
});

router.post('/commit/swipes', (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  const result = validateSwipeRecords(rows);
  if (result.errors.length > 0 && result.validRecords.length === 0) {
    return res.status(400).json(result);
  }
  const batchId = `batch_${Date.now()}`;
  const withBatch = result.validRecords.map(r => ({ ...r, import_batch_id: batchId }));
  try {
    const commitTx = db.transaction(() => {
      swipeRepo.bulkInsert(withBatch);
      return autoDetectFromExistingData();
    });
    const detectResult = commitTx();
    res.json({
      imported: withBatch.length,
      errors: result.errors,
      batch_id: batchId,
      anomalies_detected: detectResult.total,
      date_range: detectResult.dateRange,
    });
  } catch (e: any) {
    res.status(500).json({ error: '导入失败，数据已回滚', detail: e.message });
  }
});

router.post('/commit/leaves', (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  const result = validateLeaveRecords(rows);
  if (result.errors.length > 0 && result.validRecords.length === 0) {
    return res.status(400).json(result);
  }
  try {
    const commitTx = db.transaction(() => {
      leaveRepo.bulkInsert(result.validRecords);
      return autoDetectFromExistingData();
    });
    const detectResult = commitTx();
    res.json({
      imported: result.validRecords.length,
      errors: result.errors,
      anomalies_detected: detectResult.total,
      date_range: detectResult.dateRange,
    });
  } catch (e: any) {
    res.status(500).json({ error: '导入失败，数据已回滚', detail: e.message });
  }
});

router.post('/sample', (_req, res) => {
  const result = loadSampleData();
  res.json(result);
});

export default router;
