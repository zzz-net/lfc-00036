import { Router } from 'express';
import { gradeRuleRepo, ruleVersionRepo } from '../repositories';
import type { GradeRule } from '../../shared/types';

const router = Router();

router.get('/', (_req, res) => {
  res.json(gradeRuleRepo.getAll());
});

router.post('/', (req, res) => {
  const body = Array.isArray(req.body) ? req.body : [];
  let description = '手动保存';
  const rules: GradeRule[] = [];
  for (const item of body) {
    if (item && typeof item === 'object' && '__description' in item) {
      description = String((item as { __description: string }).__description);
    } else if (item && typeof item === 'object' && 'grade' in item) {
      rules.push(item as GradeRule);
    }
  }
  if (rules.length === 0) {
    return res.status(400).json({ error: '规则数据不能为空' });
  }
  const existing = gradeRuleRepo.getAll();
  if (existing.length > 0) {
    ruleVersionRepo.create(existing, '保存前自动快照');
  }
  gradeRuleRepo.saveAll(rules);
  ruleVersionRepo.create(rules, description);
  res.json({ saved: rules.length });
});

router.get('/versions', (_req, res) => {
  res.json(ruleVersionRepo.getAll());
});

router.get('/versions/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const v = ruleVersionRepo.getById(id);
  if (!v) {
    return res.status(404).json({ error: '版本不存在' });
  }
  res.json(v);
});

router.post('/versions/:id/rollback', (req, res) => {
  const id = parseInt(req.params.id);
  const v = ruleVersionRepo.getById(id);
  if (!v) {
    return res.status(404).json({ error: '版本不存在' });
  }
  const current = gradeRuleRepo.getAll();
  ruleVersionRepo.create(current, `回滚前快照（从版本 ${id}）`);
  gradeRuleRepo.saveAll(v.content);
  res.json({ rolled_back: true, version_id: id, rules: v.content });
});

export default router;
