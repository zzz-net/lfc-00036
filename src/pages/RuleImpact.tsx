import { useEffect, useState } from 'react';
import {
  GitCompare,
  Play,
  ListChecks,
  FileText,
  ChevronLeft,
  ChevronRight,
  Download,
  XCircle,
  Loader2,
  RefreshCw,
  Clock,
  User,
  CheckCircle2,
  AlertCircle,
  Eye,
} from 'lucide-react';
import { api, downloadCsv } from '@/lib/api';
import { useAppStore } from '@/store/appStore';
import { AnomalyTypeBadge } from '@/components/StatusBadge';
import type {
  GradeRule,
  RuleVersion,
  RuleVersionDiff,
  GradeRuleDiff,
  RecalcTask,
  RecalcTaskDetail,
  RecalcSummary,
  RecalcDetailItem,
  DiffChangeType,
  AnomalyType,
  OperationLog,
  RecalcTaskStatus,
} from '@shared/types';

type TabKey = 'compare' | 'create' | 'results' | 'logs';

const tabs: { key: TabKey; label: string; icon: typeof GitCompare }[] = [
  { key: 'compare', label: '规则对比', icon: GitCompare },
  { key: 'create', label: '发起重算', icon: Play },
  { key: 'results', label: '重算结果', icon: ListChecks },
  { key: 'logs', label: '操作日志', icon: FileText },
];

const statusConfig: Record<RecalcTaskStatus, { label: string; className: string }> = {
  queued: { label: '排队中', className: 'bg-gray-100 text-gray-700 border-gray-200' },
  running: { label: '运行中', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  completed: { label: '已完成', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  failed: { label: '失败', className: 'bg-red-100 text-red-700 border-red-200' },
  cancelled: { label: '已取消', className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const changeTypeConfig: Record<DiffChangeType, { label: string; className: string }> = {
  added: { label: '新增', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  removed: { label: '消失', className: 'bg-rose-100 text-rose-700 border-rose-200' },
  kept: { label: '保留', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  kept_modified: { label: '保留(改)', className: 'bg-amber-100 text-amber-700 border-amber-200' },
};

function TaskStatusBadge({ status }: { status: RecalcTaskStatus }) {
  const cfg = statusConfig[status];
  return <span className={`badge border ${cfg.className}`}>{cfg.label}</span>;
}

function ChangeTypeBadge({ type }: { type: DiffChangeType }) {
  const cfg = changeTypeConfig[type];
  return <span className={`badge border ${cfg.className}`}>{cfg.label}</span>;
}

function formatVersionOption(v: RuleVersion | null, index: number): { value: string; label: string } {
  if (!v) return { value: 'current', label: `#${index + 1} (当前)` };
  const desc = v.description || '无描述';
  const time = new Date(v.created_at).toLocaleString('zh-CN');
  return { value: String(v.id), label: `版本 #${v.id} · ${desc} · ${time}` };
}

export default function RuleImpact() {
  const addToast = useAppStore(s => s.addToast);
  const [activeTab, setActiveTab] = useState<TabKey>('compare');

  const [versions, setVersions] = useState<RuleVersion[]>([]);
  const [currentRules, setCurrentRules] = useState<GradeRule[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  useEffect(() => {
    loadMeta();
  }, []);

  async function loadMeta() {
    setLoadingMeta(true);
    try {
      const [r, v] = await Promise.all([api.rules.list(), api.rules.versions()]);
      setCurrentRules(r);
      setVersions(v);
    } catch (e: any) {
      addToast('error', e.message || '加载元数据失败');
    } finally {
      setLoadingMeta(false);
    }
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="font-display text-2xl font-bold text-gray-900">规则影响分析</h1>
        <p className="mt-1 text-sm text-gray-500">对比规则版本差异、评估影响范围、发起离线重算并导出结果</p>
      </div>

      <div className="card p-1 flex gap-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-primary-500 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {loadingMeta && activeTab !== 'logs' ? (
        <div className="py-20 text-center text-gray-400">加载中...</div>
      ) : (
        <>
          {activeTab === 'compare' && (
            <CompareTab versions={versions} currentRules={currentRules} />
          )}
          {activeTab === 'create' && (
            <CreateTab versions={versions} currentRules={currentRules} onCreated={() => setActiveTab('results')} />
          )}
          {activeTab === 'results' && (
            <ResultsTab />
          )}
          {activeTab === 'logs' && (
            <LogsTab />
          )}
        </>
      )}
    </div>
  );
}

function CompareTab({ versions, currentRules }: { versions: RuleVersion[]; currentRules: GradeRule[] }) {
  const addToast = useAppStore(s => s.addToast);
  const [oldId, setOldId] = useState<string>('current');
  const [newId, setNewId] = useState<string>(versions[0] ? String(versions[0].id) : 'current');
  const [diff, setDiff] = useState<RuleVersionDiff | null>(null);
  const [loading, setLoading] = useState(false);

  const versionOptions = [
    { value: 'current', label: `#1 (当前) · 共 ${currentRules.length} 个年级规则` },
    ...versions.map((v, i) => formatVersionOption(v, i + 1).label.startsWith('#')
      ? { value: String(v.id), label: formatVersionOption(v, i + 1).label.replace(/^#\d+ /, '') }
      : { value: String(v.id), label: formatVersionOption(v, i + 1).label }
    ),
  ];

  useEffect(() => {
    runCompare();
  }, [oldId, newId]);

  async function runCompare() {
    setLoading(true);
    try {
      const d = await api.rules.compare({
        old_id: oldId === 'current' ? 'current' : parseInt(oldId),
        new_id: newId === 'current' ? 'current' : parseInt(newId),
      });
      setDiff(d);
    } catch (e: any) {
      addToast('error', e.message || '对比失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">对比基准（old）</label>
            <select className="select" value={oldId} onChange={e => setOldId(e.target.value)}>
              {versionOptions.map(o => (
                <option key={o.value} value={o.value}>{o.value === 'current' ? '#1 (当前)' : o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">待比较（new）</label>
            <select className="select" value={newId} onChange={e => setNewId(e.target.value)}>
              {versionOptions.map(o => (
                <option key={o.value} value={o.value}>{o.value === 'current' ? '#1 (当前)' : o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card p-12 text-center text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
          对比中...
        </div>
      ) : diff && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryCard label="涉及年级" value={diff.summary.total_grades} color="slate" />
            <SummaryCard label="新增" value={diff.summary.added} color="emerald" />
            <SummaryCard label="消失" value={diff.summary.removed} color="rose" />
            <SummaryCard label="修改" value={diff.summary.modified} color="amber" />
            <SummaryCard label="未变" value={diff.summary.unchanged} color="slate" />
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-medium text-gray-900">差异明细</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">年级</th>
                    <th className="text-left px-4 py-3 font-medium">状态</th>
                    <th className="text-left px-4 py-3 font-medium">上午上课</th>
                    <th className="text-left px-4 py-3 font-medium">迟到宽容</th>
                    <th className="text-left px-4 py-3 font-medium">下午上课</th>
                    <th className="text-left px-4 py-3 font-medium">缺勤窗口</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {diff.grades.map(g => (
                    <DiffRow key={g.grade} grade={g} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DiffRow({ grade }: { grade: GradeRuleDiff }) {
  const statusClass = {
    added: 'text-emerald-700 bg-emerald-50',
    removed: 'text-rose-700 bg-rose-50',
    modified: 'text-amber-700 bg-amber-50',
    unchanged: 'text-slate-700 bg-slate-50',
  }[grade.status];
  const statusLabel = {
    added: '新增',
    removed: '消失',
    modified: '修改',
    unchanged: '未变',
  }[grade.status];

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3 font-medium text-gray-900">{grade.grade}</td>
      <td className="px-4 py-3">
        <span className={`badge border ${statusClass}`}>{statusLabel}</span>
      </td>
      {grade.fields.map(f => (
        <td key={f.field} className={`px-4 py-3 ${f.changed ? 'bg-yellow-50 text-yellow-900 font-medium' : ''}`}>
          {grade.status === 'added' ? (
            <span>{String(f.new_value ?? '')}</span>
          ) : grade.status === 'removed' ? (
            <span className="line-through text-gray-400">{String(f.old_value ?? '')}</span>
          ) : f.changed ? (
            <div className="flex items-center gap-1.5">
              <span className="line-through text-gray-400">{String(f.old_value ?? '')}</span>
              <span className="text-gray-400">→</span>
              <span>{String(f.new_value ?? '')}</span>
            </div>
          ) : (
            <span className="text-gray-600">{String(f.old_value ?? '')}</span>
          )}
        </td>
      ))}
    </tr>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: 'emerald' | 'rose' | 'amber' | 'slate' | 'blue' }) {
  const colorMap = {
    emerald: 'from-emerald-500 to-emerald-600',
    rose: 'from-rose-500 to-rose-600',
    amber: 'from-amber-500 to-amber-600',
    slate: 'from-slate-500 to-slate-600',
    blue: 'from-blue-500 to-blue-600',
  };
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colorMap[color]} flex items-center justify-center text-white font-bold shadow-sm`}>
          {value}
        </div>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-lg font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function CreateTab({
  versions,
  currentRules,
  onCreated,
}: {
  versions: RuleVersion[];
  currentRules: GradeRule[];
  onCreated: () => void;
}) {
  const addToast = useAppStore(s => s.addToast);
  const [versionId, setVersionId] = useState<string>('current');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [operator, setOperator] = useState('');
  const [preview, setPreview] = useState<RuleVersionDiff | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const versionOptions = [
    { value: 'current', label: `#1 (当前) · 共 ${currentRules.length} 个年级规则` },
    ...versions.map(v => {
      const desc = v.description || '无描述';
      const time = new Date(v.created_at).toLocaleString('zh-CN');
      return { value: String(v.id), label: `版本 #${v.id} · ${desc} · ${time}` };
    }),
  ];

  useEffect(() => {
    runPreview();
  }, [versionId]);

  async function runPreview() {
    setLoadingPreview(true);
    try {
      const d = await api.rules.compare({
        old_id: 'current',
        new_id: versionId === 'current' ? 'current' : parseInt(versionId),
      });
      setPreview(d);
    } catch (e: any) {
      addToast('error', e.message || '加载预览失败');
    } finally {
      setLoadingPreview(false);
    }
  }

  async function onSubmit() {
    if (!startDate || !endDate) {
      addToast('error', '请填写起止日期');
      return;
    }
    if (startDate > endDate) {
      addToast('error', '起始日期不能晚于结束日期');
      return;
    }
    setSubmitting(true);
    try {
      const lock = await api.recalc.lockStatus();
      if (!lock.ok && lock.blocking_task) {
        const t = lock.blocking_task;
        addToast(
          'error',
          `有冲突任务正在进行：#${t.id}（${statusConfig[t.status].label}），操作人：${t.operator}`
        );
        return;
      }
      const r = await api.recalc.createTask({
        rule_version_id: versionId === 'current' ? undefined : parseInt(versionId),
        start_date: startDate,
        end_date: endDate,
        operator: operator || undefined,
      });
      addToast('success', `重算任务 #${r.task_id} 已创建`);
      onCreated();
    } catch (e: any) {
      addToast('error', e.message || '创建任务失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-5 space-y-4">
        <h3 className="font-medium text-gray-900 flex items-center gap-2">
          <Play className="w-4 h-4 text-primary-500" />
          发起重算任务
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">规则版本</label>
            <select className="select" value={versionId} onChange={e => setVersionId(e.target.value)}>
              {versionOptions.map(o => (
                <option key={o.value} value={o.value}>{o.value === 'current' ? '#1 (当前)' : o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">操作人</label>
            <input
              type="text"
              className="input"
              placeholder="可选，如：张老师"
              value={operator}
              onChange={e => setOperator(e.target.value)}
            />
          </div>
          <div>
            <label className="label">开始日期</label>
            <input
              type="date"
              className="input"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">结束日期</label>
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={onSubmit} disabled={submitting} className="btn-primary gap-2">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            开始重算
          </button>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Eye className="w-4 h-4 text-gray-500" />
          预计影响预览（相对当前规则）
        </h3>
        {loadingPreview ? (
          <div className="py-8 text-center text-gray-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            加载预览...
          </div>
        ) : preview && (
          <>
            <div className="grid grid-cols-4 gap-3 mb-4">
              <SummaryCard label="新增规则" value={preview.summary.added} color="emerald" />
              <SummaryCard label="删除规则" value={preview.summary.removed} color="rose" />
              <SummaryCard label="修改规则" value={preview.summary.modified} color="amber" />
              <SummaryCard label="涉及年级" value={preview.summary.total_grades} color="blue" />
            </div>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">年级</th>
                    <th className="text-left px-4 py-3 font-medium">状态</th>
                    <th className="text-left px-4 py-3 font-medium">说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.grades.filter(g => g.status !== 'unchanged').length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                        与当前规则一致，无差异
                      </td>
                    </tr>
                  ) : (
                    preview.grades.filter(g => g.status !== 'unchanged').map(g => {
                      const label = g.status === 'added' ? '新增' : g.status === 'removed' ? '删除' : '修改';
                      const changedFields = g.fields.filter(f => f.changed).map(f => f.field_label).join('、');
                      return (
                        <tr key={g.grade} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{g.grade}</td>
                          <td className="px-4 py-3">
                            <span className={`badge border ${
                              g.status === 'added' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                              g.status === 'removed' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                              'bg-amber-100 text-amber-700 border-amber-200'
                            }`}>{label}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {g.status === 'modified' ? `修改字段：${changedFields}` : '规则整体变动'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ResultsTab() {
  const addToast = useAppStore(s => s.addToast);
  const [tasks, setTasks] = useState<RecalcTask[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [taskDetail, setTaskDetail] = useState<RecalcTaskDetail | null>(null);
  const [summary, setSummary] = useState<RecalcSummary | null>(null);
  const [details, setDetails] = useState<{ data: RecalcDetailItem[]; total: number }>({ data: [], total: 0 });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filters, setFilters] = useState<{
    change_type?: DiffChangeType;
    anomaly_type?: AnomalyType;
    grade?: string;
    class_name?: string;
  }>({});
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [allGrades, setAllGrades] = useState<string[]>([]);

  useEffect(() => {
    loadTasks();
    api.students.grades().then(setAllGrades);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (tasks.some(t => t.status === 'running' || t.status === 'queued')) {
        loadTasks();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [tasks]);

  async function loadTasks() {
    try {
      const list = await api.recalc.listTasks();
      setTasks(list);
      if (selectedId) {
        const cur = list.find(t => t.id === selectedId);
        if (cur) {
          setTaskDetail(cur as RecalcTaskDetail);
          if (cur.status === 'completed') {
            loadSummary(cur.id);
            loadDetails(cur.id);
          }
        }
      } else if (list.length > 0) {
        onSelect(list[0].id);
      }
    } catch (e: any) {
      addToast('error', e.message || '加载任务列表失败');
    } finally {
      setLoadingTasks(false);
    }
  }

  async function onSelect(id: number) {
    setSelectedId(id);
    setPage(1);
    setFilters({});
    setLoadingDetail(true);
    try {
      const d = await api.recalc.getTask(id);
      setTaskDetail(d);
      if (d.status === 'completed') {
        await Promise.all([loadSummary(id), loadDetails(id)]);
      }
    } catch (e: any) {
      addToast('error', e.message || '加载任务详情失败');
    } finally {
      setLoadingDetail(false);
    }
  }

  async function loadSummary(id: number) {
    try {
      setSummary(await api.recalc.getSummary(id));
    } catch (e: any) {
      addToast('error', e.message || '加载摘要失败');
    }
  }

  async function loadDetails(id: number, p = 1) {
    try {
      const r = await api.recalc.getDetails(id, { ...filters, page: p, page_size: pageSize });
      setDetails({ data: r.data, total: r.total });
      setPage(p);
    } catch (e: any) {
      addToast('error', e.message || '加载明细失败');
    }
  }

  function onFilter(patch: typeof filters) {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (selectedId) loadDetails(selectedId, 1);
  }

  async function onCancel() {
    if (!selectedId) return;
    if (!confirm('确定取消该任务吗？')) return;
    setCancelling(true);
    try {
      await api.recalc.cancelTask(selectedId);
      addToast('success', '任务已取消');
      loadTasks();
    } catch (e: any) {
      addToast('error', e.message || '取消失败');
    } finally {
      setCancelling(false);
    }
  }

  async function onExportDiff() {
    if (!selectedId) return;
    try {
      const csv = await api.export.recalcDiff(selectedId);
      downloadCsv(csv, `重算差异_#${selectedId}_${Date.now()}.csv`);
      addToast('success', '导出成功');
    } catch (e: any) {
      addToast('error', e.message || '导出失败');
    }
  }

  async function onExportSummary() {
    if (!selectedId) return;
    try {
      const csv = await api.export.recalcSummary(selectedId);
      downloadCsv(csv, `重算摘要_#${selectedId}_${Date.now()}.csv`);
      addToast('success', '导出成功');
    } catch (e: any) {
      addToast('error', e.message || '导出失败');
    }
  }

  const totalPages = Math.ceil(details.total / pageSize);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card overflow-hidden lg:col-span-1">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-medium text-gray-900">任务列表</h3>
            <button onClick={loadTasks} className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {loadingTasks ? (
            <div className="p-12 text-center text-gray-400">加载中...</div>
          ) : tasks.length === 0 ? (
            <div className="p-12 text-center text-gray-400">暂无任务</div>
          ) : (
            <div className="max-h-[560px] overflow-auto divide-y divide-gray-100">
              {tasks.map(t => (
                <button
                  key={t.id}
                  onClick={() => onSelect(t.id)}
                  className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${
                    selectedId === t.id ? 'bg-primary-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-gray-900">#{t.id}</span>
                    <TaskStatusBadge status={t.status} />
                  </div>
                  <p className="text-xs text-gray-500 mb-1">
                    <Clock className="w-3 h-3 inline mr-1" />
                    {new Date(t.created_at).toLocaleString('zh-CN')}
                  </p>
                  <p className="text-xs text-gray-500 mb-1">
                    <User className="w-3 h-3 inline mr-1" />
                    {t.operator || '系统'} · {t.start_date} ~ {t.end_date}
                  </p>
                  {t.status === 'running' && (
                    <div className="mt-2">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all"
                          style={{ width: `${t.progress_percent || 0}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{t.progress_message || `进度 ${t.progress_percent || 0}%`}</p>
                    </div>
                  )}
                  {t.status === 'failed' && t.error_message && (
                    <p className="text-xs text-red-600 mt-1">{t.error_message}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-5">
          {!taskDetail ? (
            <div className="card p-12 text-center text-gray-400">请选择左侧任务查看详情</div>
          ) : loadingDetail ? (
            <div className="card p-12 text-center text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              加载中...
            </div>
          ) : (
            <>
              <div className="card p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-medium text-gray-900 flex items-center gap-2">
                      任务 #{taskDetail.id}
                      <TaskStatusBadge status={taskDetail.status} />
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      {taskDetail.start_date} ~ {taskDetail.end_date} · 操作人：{taskDetail.operator || '系统'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {(taskDetail.status === 'running' || taskDetail.status === 'queued') && (
                      <button onClick={onCancel} disabled={cancelling} className="btn-danger gap-2 text-xs py-1.5 px-3">
                        {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                        取消任务
                      </button>
                    )}
                    {taskDetail.status === 'completed' && (
                      <>
                        <button onClick={onExportSummary} className="btn-secondary gap-2 text-xs py-1.5 px-3">
                          <Download className="w-3.5 h-3.5" />
                          导出摘要
                        </button>
                        <button onClick={onExportDiff} className="btn-primary gap-2 text-xs py-1.5 px-3">
                          <Download className="w-3.5 h-3.5" />
                          导出差异
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {taskDetail.status === 'running' && (
                  <div className="mb-4">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all"
                        style={{ width: `${taskDetail.progress_percent || 0}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{taskDetail.progress_message || `进度 ${taskDetail.progress_percent || 0}%`}</p>
                  </div>
                )}
              </div>

              {taskDetail.status === 'completed' && summary && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <SummaryCard label="新增异常" value={summary.added} color="emerald" />
                    <SummaryCard label="消失异常" value={summary.removed} color="rose" />
                    <SummaryCard label="保留" value={summary.kept} color="slate" />
                    <SummaryCard label="保留(改)" value={summary.kept_modified} color="amber" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="card p-4">
                      <h4 className="text-sm font-medium text-gray-900 mb-3">按年级汇总</h4>
                      <div className="space-y-2 max-h-64 overflow-auto">
                        {summary.by_grade.length === 0 ? (
                          <p className="text-xs text-gray-400">无数据</p>
                        ) : (
                          summary.by_grade.map(g => (
                            <div key={g.grade} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-50 last:border-0">
                              <span className="font-medium text-gray-700">{g.grade}</span>
                              <div className="flex gap-2">
                                <span className="text-emerald-600">+{g.added}</span>
                                <span className="text-rose-600">-{g.removed}</span>
                                <span className="text-slate-500">={g.kept}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="card p-4">
                      <h4 className="text-sm font-medium text-gray-900 mb-3">按班级汇总</h4>
                      <div className="space-y-2 max-h-64 overflow-auto">
                        {summary.by_class.length === 0 ? (
                          <p className="text-xs text-gray-400">无数据</p>
                        ) : (
                          summary.by_class.map(c => (
                            <div key={`${c.grade}-${c.class_name}`} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-50 last:border-0">
                              <span className="font-medium text-gray-700">{c.grade} {c.class_name}</span>
                              <div className="flex gap-2">
                                <span className="text-emerald-600">+{c.added}</span>
                                <span className="text-rose-600">-{c.removed}</span>
                                <span className="text-slate-500">={c.kept}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="card p-4">
                      <h4 className="text-sm font-medium text-gray-900 mb-3">按异常类型汇总</h4>
                      <div className="space-y-2 max-h-64 overflow-auto">
                        {summary.by_type.length === 0 ? (
                          <p className="text-xs text-gray-400">无数据</p>
                        ) : (
                          summary.by_type.map(t => (
                            <div key={t.anomaly_type} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-50 last:border-0">
                              <AnomalyTypeBadge type={t.anomaly_type} />
                              <div className="flex gap-2">
                                <span className="text-emerald-600">+{t.added}</span>
                                <span className="text-rose-600">-{t.removed}</span>
                                <span className="text-slate-500">={t.kept}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="card overflow-hidden">
                    <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
                      <h3 className="font-medium text-gray-900 mr-3">明细列表</h3>
                      <select
                        className="select w-36 text-xs py-1.5"
                        value={filters.change_type || ''}
                        onChange={e => onFilter({ change_type: (e.target.value || undefined) as DiffChangeType | undefined })}
                      >
                        <option value="">全部变化类型</option>
                        <option value="added">新增</option>
                        <option value="removed">消失</option>
                        <option value="kept">保留</option>
                        <option value="kept_modified">保留(改)</option>
                      </select>
                      <select
                        className="select w-32 text-xs py-1.5"
                        value={filters.anomaly_type || ''}
                        onChange={e => onFilter({ anomaly_type: (e.target.value || undefined) as AnomalyType | undefined })}
                      >
                        <option value="">全部异常类型</option>
                        <option value="late">迟到</option>
                        <option value="absent">缺勤</option>
                        <option value="duplicate_swipe">重复刷卡</option>
                        <option value="leave_exception">请假例外</option>
                      </select>
                      <select
                        className="select w-28 text-xs py-1.5"
                        value={filters.grade || ''}
                        onChange={e => onFilter({ grade: e.target.value || undefined, class_name: undefined })}
                      >
                        <option value="">全部年级</option>
                        {allGrades.map(g => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                      <span className="text-xs text-gray-500 ml-auto">共 {details.total} 条</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr>
                            <th className="text-left px-4 py-3 font-medium">变化</th>
                            <th className="text-left px-4 py-3 font-medium">异常类型</th>
                            <th className="text-left px-4 py-3 font-medium">学生</th>
                            <th className="text-left px-4 py-3 font-medium">班级</th>
                            <th className="text-left px-4 py-3 font-medium">日期</th>
                            <th className="text-left px-4 py-3 font-medium">说明</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {details.data.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-12 text-center text-gray-400">无明细数据</td>
                            </tr>
                          ) : (
                            details.data.map(d => (
                              <tr key={d.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3"><ChangeTypeBadge type={d.change_type} /></td>
                                <td className="px-4 py-3"><AnomalyTypeBadge type={d.anomaly_type} /></td>
                                <td className="px-4 py-3">
                                  <div className="font-medium text-gray-900">{d.student_name || d.student_id}</div>
                                  <div className="text-xs text-gray-400">{d.student_id}</div>
                                </td>
                                <td className="px-4 py-3 text-gray-600">{d.grade} {d.class_name}</td>
                                <td className="px-4 py-3 text-gray-600">{d.anomaly_date}</td>
                                <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                                  {d.change_type === 'kept_modified' ? (
                                    <span>
                                      <span className="line-through text-gray-400">{d.old_description}</span>
                                      <span className="mx-1">→</span>
                                      <span>{d.new_description}</span>
                                    </span>
                                  ) : (
                                    d.new_description || d.old_description || '-'
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    {totalPages > 1 && (
                      <div className="p-4 border-t border-gray-100 flex items-center justify-between">
                        <p className="text-xs text-gray-500">第 {page} / {totalPages} 页</p>
                        <div className="flex gap-1">
                          <button
                            onClick={() => loadDetails(selectedId!, page - 1)}
                            disabled={page <= 1}
                            className="btn-secondary px-3 py-1.5 text-xs gap-1 disabled:opacity-40"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            上一页
                          </button>
                          <button
                            onClick={() => loadDetails(selectedId!, page + 1)}
                            disabled={page >= totalPages}
                            className="btn-secondary px-3 py-1.5 text-xs gap-1 disabled:opacity-40"
                          >
                            下一页
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {taskDetail.status === 'failed' && (
                <div className="card p-5 bg-red-50 border-red-200">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-red-900">任务失败</h4>
                      <p className="text-sm text-red-700 mt-1">{taskDetail.error_message || '未知错误'}</p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LogsTab() {
  const addToast = useAppStore(s => s.addToast);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLogs();
  }, []);

  async function loadLogs() {
    try {
      setLogs(await api.recalc.logs());
    } catch (e: any) {
      addToast('error', e.message || '加载日志失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-medium text-gray-900 flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-500" />
          操作日志
        </h3>
        <button onClick={loadLogs} className="text-gray-400 hover:text-gray-600">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {loading ? (
        <div className="p-12 text-center text-gray-400">加载中...</div>
      ) : logs.length === 0 ? (
        <div className="p-12 text-center text-gray-400">暂无日志</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">时间</th>
                <th className="text-left px-4 py-3 font-medium">操作人</th>
                <th className="text-left px-4 py-3 font-medium">动作</th>
                <th className="text-left px-4 py-3 font-medium">目标类型</th>
                <th className="text-left px-4 py-3 font-medium">目标ID</th>
                <th className="text-left px-4 py-3 font-medium">摘要</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map(l => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {new Date(l.created_at).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 text-gray-700">
                      <User className="w-3.5 h-3.5 text-gray-400" />
                      {l.operator}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="badge bg-primary-50 text-primary-700 border-primary-200 border">{l.action}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{l.target_type}</td>
                  <td className="px-4 py-3 text-gray-600">{l.target_id ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-700 max-w-md">{l.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
