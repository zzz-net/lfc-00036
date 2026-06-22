import { Router } from 'express';
import { swipeRepo, leaveRepo } from '../repositories';
import { validateSwipeRecords, validateLeaveRecords } from '../validators';
import { autoDetectFromExistingData } from '../anomalyEngine';
import { loadSampleData } from '../sampleData';

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
  swipeRepo.bulkInsert(withBatch);
  const detectResult = autoDetectFromExistingData();
  res.json({
    imported: withBatch.length,
    errors: result.errors,
    batch_id: batchId,
    anomalies_detected: detectResult.total,
    date_range: detectResult.dateRange,
  });
});

router.post('/commit/leaves', (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  const result = validateLeaveRecords(rows);
  if (result.errors.length > 0 && result.validRecords.length === 0) {
    return res.status(400).json(result);
  }
  leaveRepo.bulkInsert(result.validRecords);
  const detectResult = autoDetectFromExistingData();
  res.json({
    imported: result.validRecords.length,
    errors: result.errors,
    anomalies_detected: detectResult.total,
    date_range: detectResult.dateRange,
  });
});

router.post('/sample', (_req, res) => {
  const result = loadSampleData();
  res.json(result);
});

export default router;
