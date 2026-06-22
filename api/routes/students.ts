import { Router } from 'express';
import { studentRepo } from '../repositories';
import { validateStudentRecords } from '../validators';

const router = Router();

router.get('/', (_req, res) => {
  res.json(studentRepo.getAll());
});

router.get('/grades', (_req, res) => {
  res.json(studentRepo.getGrades());
});

router.get('/classes', (req, res) => {
  const grade = req.query.grade as string | undefined;
  res.json(studentRepo.getClasses(grade));
});

router.post('/', (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [req.body];
  const result = validateStudentRecords(rows);
  if (result.errors.length > 0) {
    return res.status(400).json(result);
  }
  studentRepo.bulkUpsert(result.validRecords);
  res.json({ imported: result.valid_records });
});

export default router;
