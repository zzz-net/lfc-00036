import { Router } from 'express';
import { gradeRuleRepo, ruleVersionRepo, computeRuleDiff } from '../repositories';
import type { GradeRule, RuleVersionDiff } from '../../shared/types';

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

function resolveRules(idParam: string | undefined): { rules: GradeRule[]; version_id: number | null; description?: string } {
  if (!idParam || idParam === 'current') {
    return { rules: gradeRuleRepo.getAll(), version_id: null, description: '当前生效规则' };
  }
  const id = parseInt(idParam);
  if (isNaN(id)) {
    return { rules: gradeRuleRepo.getAll(), version_id: null, description: '当前生效规则' };
  }
  const v = ruleVersionRepo.getById(id);
  if (!v) {
    return { rules: gradeRuleRepo.getAll(), version_id: null, description: '当前生效规则' };
  }
  return { rules: v.content, version_id: v.id, description: v.description };
}

router.get('/compare', (req, res) => {
  const oldId = req.query.old_id as string | undefined;
  const newId = req.query.new_id as string | undefined;

  const oldRes = resolveRules(oldId);
  const newRes = resolveRules(newId);

  const diff: RuleVersionDiff = computeRuleDiff(oldRes.rules, newRes.rules, {
    old_version_id: oldRes.version_id,
    new_version_id: newRes.version_id,
    old_description: oldRes.description,
    new_description: newRes.description,
  });
  res.json(diff);
});

router.get('/compare/:newId', (req, res) => {
  const newId = req.params.newId;
  const oldRes = resolveRules(undefined);
  const newRes = resolveRules(newId);

  const diff: RuleVersionDiff = computeRuleDiff(oldRes.rules, newRes.rules, {
    old_version_id: oldRes.version_id,
    new_version_id: newRes.version_id,
    old_description: oldRes.description,
    new_description: newRes.description,
  });
  res.json(diff);
});

router.post('/save-dry-run', (req, res) => {
  const body = Array.isArray(req.body) ? req.body : [];
  let description = 'dry-run';
  const rules: GradeRule[] = [];
  for (const item of body) {
    if (item && typeof item === 'object' && '__description' in item) {
      description = String((item as { __description: string }).__description);
    } else if (item && typeof item === 'object' && 'grade' in item) {
      rules.push(item as GradeRule);
    }
  }
  const current = gradeRuleRepo.getAll();
  const diff: RuleVersionDiff = computeRuleDiff(current, rules, {
    old_version_id: null,
    new_version_id: null,
    old_description: '当前生效规则',
    new_description: description,
  });
  res.json(diff);
});

export default router;
