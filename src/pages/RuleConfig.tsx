import { useEffect, useState } from 'react';
import {
  Settings,
  Save,
  RotateCcw,
  History,
  Clock,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/store/appStore';
import type { GradeRule, RuleVersion } from '@shared/types';

export default function RuleConfig() {
  const addToast = useAppStore(s => s.addToast);
  const [rules, setRules] = useState<GradeRule[]>([]);
  const [versions, setVersions] = useState<RuleVersion[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showVersions, setShowVersions] = useState(false);
  const [saveDescription, setSaveDescription] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [r, v] = await Promise.all([api.rules.list(), api.rules.versions()]);
      if (r.length === 0) {
        setRules([
          { grade: '高一', morning_start_time: '08:00', late_tolerance_minutes: 5, afternoon_start_time: '14:00', absent_window_minutes: 120 },
          { grade: '高二', morning_start_time: '08:00', late_tolerance_minutes: 5, afternoon_start_time: '14:00', absent_window_minutes: 120 },
          { grade: '高三', morning_start_time: '08:00', late_tolerance_minutes: 5, afternoon_start_time: '14:00', absent_window_minutes: 120 },
        ]);
      } else {
        setRules(r);
      }
      setVersions(v);
    } catch (e: any) {
      addToast('error', e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  function updateRule(grade: string, patch: Partial<GradeRule>) {
    setDirty(true);
    setRules(prev => prev.map(r => (r.grade === grade ? { ...r, ...patch } : r)));
  }

  function addGrade() {
    const next = prompt('请输入新年级名称（如：初一）');
    if (!next) return;
    if (rules.some(r => r.grade === next)) {
      addToast('error', '该年级已存在');
      return;
    }
    setDirty(true);
    setRules(prev => [
      ...prev,
      { grade: next, morning_start_time: '08:00', late_tolerance_minutes: 5, afternoon_start_time: '14:00', absent_window_minutes: 120 },
    ]);
  }

  function removeGrade(grade: string) {
    if (!confirm(`确定删除年级「${grade}」的规则吗？`)) return;
    setDirty(true);
    setRules(prev => prev.filter(r => r.grade !== grade));
  }

  async function onSave() {
    setSaving(true);
    try {
      await api.rules.save(rules, saveDescription || undefined);
      addToast('success', '规则已保存');
      setDirty(false);
      setSaveDescription('');
      setVersions(await api.rules.versions());
      const r = await api.anomalies.redetect();
      addToast('info', `已按新规则重新识别，共 ${r.total} 个异常`);
    } catch (e: any) {
      addToast('error', e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function onRollback(id: number) {
    if (!confirm('确定回滚到此版本？当前规则将被覆盖。')) return;
    try {
      const r = await api.rules.rollback(id);
      setRules(r.rules);
      setDirty(false);
      addToast('success', '已回滚到历史版本');
      setVersions(await api.rules.versions());
    } catch (e: any) {
      addToast('error', e.message || '回滚失败');
    }
  }

  if (loading) return <div className="py-20 text-center text-gray-400">加载中...</div>;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-gray-900">规则配置</h1>
          <p className="mt-1 text-sm text-gray-500">为各年级设置上课时间、迟到宽容度及缺勤判定阈值</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowVersions(!showVersions)} className="btn-secondary gap-2">
            <History className="w-4 h-4" />
            历史版本
          </button>
          <button onClick={onSave} disabled={saving || !dirty} className="btn-primary gap-2">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            保存规则
          </button>
        </div>
      </div>

      {dirty && (
        <div className="card p-4 flex items-center justify-between bg-amber-50 border-amber-200">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-900">有未保存的修改</p>
              <p className="text-xs text-amber-700">保存后规则将立即生效并重新识别所有异常</p>
            </div>
          </div>
          <input
            type="text"
            className="input w-72"
            placeholder="版本描述（可选，如：冬季作息调整）"
            value={saveDescription}
            onChange={e => setSaveDescription(e.target.value)}
          />
        </div>
      )}

      {showVersions && (
        <div className="card p-5">
          <h2 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
            <History className="w-4 h-4 text-gray-500" />
            规则版本历史
          </h2>
          {versions.length === 0 ? (
            <p className="text-sm text-gray-400">暂无历史版本</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-auto">
              {versions.map(v => (
                <div key={v.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:bg-gray-50">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">版本 #{v.id}</span>
                      {v.id === versions[0].id && (
                        <span className="badge bg-emerald-100 text-emerald-700 border border-emerald-200">当前</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(v.created_at).toLocaleString('zh-CN')} · {v.description || '无描述'} · {v.content.length} 个年级规则
                    </p>
                  </div>
                  <button
                    onClick={() => onRollback(v.id)}
                    disabled={v.id === versions[0].id}
                    className="btn-secondary px-3 py-1.5 text-xs gap-1.5 disabled:opacity-40"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    回滚到此版本
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {rules.map(rule => (
          <div key={rule.grade} className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-sm">
                  <Settings className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-gray-900">{rule.grade}</h3>
                  <p className="text-xs text-gray-500">年级考勤阈值配置</p>
                </div>
              </div>
              {rules.length > 1 && (
                <button
                  onClick={() => removeGrade(rule.grade)}
                  className="text-red-500 hover:text-red-600 text-sm font-medium"
                >
                  删除
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="label">上午上课时间</label>
                <input
                  type="time"
                  className="input"
                  value={rule.morning_start_time}
                  onChange={e => updateRule(rule.grade, { morning_start_time: e.target.value })}
                />
              </div>
              <div>
                <label className="label">下午上课时间</label>
                <input
                  type="time"
                  className="input"
                  value={rule.afternoon_start_time}
                  onChange={e => updateRule(rule.grade, { afternoon_start_time: e.target.value })}
                />
              </div>
              <div>
                <label className="label">迟到宽容（分钟）</label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  className="input"
                  value={rule.late_tolerance_minutes}
                  onChange={e => updateRule(rule.grade, { late_tolerance_minutes: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="label">缺勤判定窗口（分钟）</label>
                <input
                  type="number"
                  min={30}
                  max={480}
                  className="input"
                  value={rule.absent_window_minutes}
                  onChange={e => updateRule(rule.grade, { absent_window_minutes: parseInt(e.target.value) || 120 })}
                />
              </div>
            </div>

            <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>
                超过上课时间 <strong className="text-gray-700">{rule.late_tolerance_minutes} 分钟</strong> 算迟到；
                {rule.absent_window_minutes} 分钟内无刷卡记为缺勤（仅工作日）。
                有效请假自动抵扣对应异常。
              </span>
            </div>
          </div>
        ))}
      </div>

      <button onClick={addGrade} className="btn-secondary w-full justify-center gap-2 border-dashed">
        <Settings className="w-4 h-4" />
        新增年级规则
      </button>
    </div>
  );
}
