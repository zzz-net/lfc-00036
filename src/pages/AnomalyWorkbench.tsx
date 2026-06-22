import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Filter,
  Eye,
  CheckCircle,
  XCircle,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  X,
  History,
  Clock,
  User,
  Calendar,
  Download,
  RefreshCw,
} from 'lucide-react';
import { api, downloadCsv } from '@/lib/api';
import { useAppStore } from '@/store/appStore';
import { AnomalyTypeBadge, AnomalyStatusBadge, LeaveTypeBadge } from '@/components/StatusBadge';
import type {
  Anomaly,
  AnomalyFilters,
  AnomalyType,
  AnomalyStatus,
  Student,
  SwipeRecord,
  LeaveRecord,
  ReviewHistory,
} from '@shared/types';

export default function AnomalyWorkbench() {
  const addToast = useAppStore(s => s.addToast);
  const savedFilters = useAppStore(s => s.anomalyFilters);
  const setSavedFilters = useAppStore(s => s.setAnomalyFilters);
  const loadPersisted = useAppStore(s => s.loadPersistedState);

  const [filters, setFilters] = useState<AnomalyFilters>({ page: 1, page_size: 20, ...savedFilters });
  const [data, setData] = useState<{ data: (Anomaly & { student?: Student })[]; total: number }>({ data: [], total: 0 });
  const [grades, setGrades] = useState<string[]>([]);
  const [classes, setClasses] = useState<{ grade: string; class_name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<{
    anomaly: Anomaly & { student?: Student };
    swipes: SwipeRecord[];
    leaves: LeaveRecord[];
    history: ReviewHistory[];
  } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [redetecting, setRedetecting] = useState(false);

  useEffect(() => {
    loadPersisted();
  }, [loadPersisted]);

  useEffect(() => {
    api.students.grades().then(setGrades);
    api.students.classes().then(setClasses);
  }, []);

  useEffect(() => {
    fetchData();
  }, [filters]);

  async function fetchData() {
    setLoading(true);
    try {
      const r = await api.anomalies.list(filters);
      setData({ data: r.data, total: r.total });
    } catch (e: any) {
      addToast('error', e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function fetchDetail(id: number) {
    setSelected(id);
    try {
      setDetail(await api.anomalies.detail(id));
      setReviewNote('');
    } catch (e: any) {
      addToast('error', e.message || '加载详情失败');
    }
  }

  function updateFilter(patch: Partial<AnomalyFilters>) {
    const next = { ...filters, ...patch, page: 1 };
    setFilters(next);
    setSavedFilters(next);
  }

  async function onReview(action: 'confirm' | 'dismiss' | 'revert') {
    if (!selected) return;
    setSubmitting(true);
    try {
      const actionMap = { confirm: undefined, dismiss: 'dismiss', revert: 'revert' };
      await api.anomalies.review(selected, { note: reviewNote, action: actionMap[action] });
      addToast('success', '操作成功');
      fetchData();
      fetchDetail(selected);
    } catch (e: any) {
      addToast('error', e.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function onExport() {
    try {
      const csv = await api.export.anomalies(filters);
      downloadCsv(csv, `异常明细_${Date.now()}.csv`);
      addToast('success', '导出成功');
    } catch (e: any) {
      addToast('error', e.message || '导出失败');
    }
  }

  async function onRedetect() {
    setRedetecting(true);
    try {
      const r = await api.anomalies.redetect();
      addToast('success', `重新识别完成，共 ${r.total} 个异常`);
      fetchData();
    } catch (e: any) {
      addToast('error', e.message || '重新识别失败');
    } finally {
      setRedetecting(false);
    }
  }

  const totalPages = Math.ceil(data.total / (filters.page_size || 20));
  const filteredClasses = filters.grade ? classes.filter(c => c.grade === filters.grade) : classes;

  return (
    <div className="space-y-5 animate-fadeIn h-full flex flex-col">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-gray-900">异常分析工作台</h1>
          <p className="mt-1 text-sm text-gray-500">按条件筛选异常记录，进行人工复核、添加备注或回退误判</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onRedetect} disabled={redetecting} className="btn-secondary gap-2">
            <RefreshCw className={`w-4 h-4 ${redetecting ? 'animate-spin' : ''}`} />
            {redetecting ? '识别中' : '重新识别异常'}
          </button>
          <button onClick={onExport} className="btn-primary gap-2">
            <Download className="w-4 h-4" />
            导出 CSV
          </button>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">筛选条件</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="label">年级</label>
            <select
              className="select"
              value={filters.grade || ''}
              onChange={e => updateFilter({ grade: e.target.value || undefined })}
            >
              <option value="">全部年级</option>
              {grades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="label">班级</label>
            <select
              className="select"
              value={filters.class_name || ''}
              onChange={e => updateFilter({ class_name: e.target.value || undefined })}
            >
              <option value="">全部班级</option>
              {filteredClasses.map(c => (
                <option key={`${c.grade}-${c.class_name}`} value={c.class_name}>
                  {c.grade} {c.class_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">异常类型</label>
            <select
              className="select"
              value={filters.anomaly_type || ''}
              onChange={e => updateFilter({ anomaly_type: (e.target.value as AnomalyType) || undefined })}
            >
              <option value="">全部类型</option>
              <option value="late">迟到</option>
              <option value="absent">缺勤</option>
              <option value="duplicate_swipe">重复刷卡</option>
              <option value="leave_exception">请假例外</option>
            </select>
          </div>
          <div>
            <label className="label">处理状态</label>
            <select
              className="select"
              value={filters.status || ''}
              onChange={e => updateFilter({ status: (e.target.value as AnomalyStatus) || undefined })}
            >
              <option value="">全部状态</option>
              <option value="pending">待处理</option>
              <option value="confirmed">已确认</option>
              <option value="reverted">已回退</option>
              <option value="dismissed">已忽略</option>
            </select>
          </div>
          <div>
            <label className="label">开始日期</label>
            <input
              type="date"
              className="input"
              value={filters.start_date || ''}
              onChange={e => updateFilter({ start_date: e.target.value || undefined })}
            />
          </div>
          <div>
            <label className="label">结束日期</label>
            <input
              type="date"
              className="input"
              value={filters.end_date || ''}
              onChange={e => updateFilter({ end_date: e.target.value || undefined })}
            />
          </div>
        </div>
      </div>

      <div className="card flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">日期</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">学号</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">姓名</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">年级/班级</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">异常类型</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">异常描述</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">状态</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="py-12 text-center text-gray-400">加载中...</td></tr>
              ) : data.data.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-gray-400">暂无异常数据</td></tr>
              ) : data.data.map(a => (
                <tr
                  key={a.id}
                  className={`hover:bg-gray-50 cursor-pointer transition-colors ${selected === a.id ? 'bg-primary-50' : ''}`}
                  onClick={() => fetchDetail(a.id)}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">{a.anomaly_date}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-gray-700">{a.student_id}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-900 font-medium">{a.student?.name || '-'}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                    {a.student ? `${a.student.grade} ${a.student.class_name}` : '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap"><AnomalyTypeBadge type={a.anomaly_type} /></td>
                  <td className="px-4 py-3 text-gray-600 max-w-md truncate" title={a.description}>{a.description || '-'}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><AnomalyStatusBadge status={a.status} /></td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button
                      onClick={e => { e.stopPropagation(); fetchDetail(a.id); }}
                      className="text-primary-500 hover:text-primary-600 text-sm font-medium inline-flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            共 <span className="font-medium text-gray-700">{data.total}</span> 条记录
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilters({ ...filters, page: Math.max(1, (filters.page || 1) - 1) })}
              disabled={(filters.page || 1) <= 1}
              className="btn-secondary px-3 py-1.5 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-gray-600 px-3">
              第 {filters.page || 1} / {totalPages || 1} 页
            </span>
            <button
              onClick={() => setFilters({ ...filters, page: Math.min(totalPages, (filters.page || 1) + 1) })}
              disabled={(filters.page || 1) >= totalPages}
              className="btn-secondary px-3 py-1.5 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {selected && detail && (
        <div className="fixed inset-0 z-40 flex justify-end animate-fadeIn" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative w-full max-w-lg bg-white shadow-2xl overflow-auto animate-slideIn flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="font-display text-lg font-bold text-gray-900">异常详情</h2>
                <p className="text-xs text-gray-500 mt-0.5">#{detail.anomaly.id}</p>
              </div>
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5 flex-1">
              <div className="space-y-2">
                <div className="flex gap-3">
                  <AnomalyTypeBadge type={detail.anomaly.anomaly_type} />
                  <AnomalyStatusBadge status={detail.anomaly.status} />
                </div>
                <p className="text-gray-700">{detail.anomaly.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-start gap-2 text-gray-600">
                  <User className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
                  <div>
                    <p className="font-medium text-gray-900">{detail.anomaly.student?.name || '-'}</p>
                    <p className="text-xs text-gray-500">
                      {detail.anomaly.student ? `${detail.anomaly.student_id} · ${detail.anomaly.student.grade} ${detail.anomaly.student.class_name}` : detail.anomaly.student_id}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-gray-600">
                  <Calendar className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
                  <div>
                    <p className="font-medium text-gray-900">{detail.anomaly.anomaly_date}</p>
                    <p className="text-xs text-gray-500">异常发生日期</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-medium text-gray-900 text-sm mb-2 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-gray-500" />
                  当日刷卡记录
                </h3>
                {detail.swipes.length === 0 ? (
                  <p className="text-sm text-gray-400 bg-gray-50 rounded-lg px-3 py-2">无刷卡记录</p>
                ) : (
                  <div className="space-y-1.5">
                    {detail.swipes.map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                        <span className="font-mono text-gray-700">{new Date(s.swipe_time).toLocaleTimeString('zh-CN')}</span>
                        <span className="text-xs text-gray-500">{s.device_location || '-'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {detail.leaves.length > 0 && (
                <div>
                  <h3 className="font-medium text-gray-900 text-sm mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-gray-500" />
                    当日请假记录
                  </h3>
                  <div className="space-y-1.5">
                    {detail.leaves.map((l, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="flex items-center justify-between text-sm">
                          <LeaveTypeBadge type={String(l.leave_type)} />
                          <span className="font-mono text-xs text-gray-500">
                            {new Date(l.start_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} - {new Date(l.end_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {l.reason && <p className="text-xs text-gray-500 mt-1">{l.reason}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-medium text-gray-900 text-sm mb-2">处理备注</h3>
                <textarea
                  className="input min-h-[80px]"
                  value={reviewNote}
                  onChange={e => setReviewNote(e.target.value)}
                  placeholder="输入处理备注（可选）"
                />
              </div>

              {(detail.anomaly.status === 'pending') && (
                <div className="flex gap-2 pt-2">
                  <button onClick={() => onReview('confirm')} disabled={submitting} className="btn-success flex-1 gap-1.5">
                    <CheckCircle className="w-4 h-4" />
                    确认异常
                  </button>
                  <button onClick={() => onReview('dismiss')} disabled={submitting} className="btn-secondary flex-1 gap-1.5">
                    <XCircle className="w-4 h-4" />
                    标记误判
                  </button>
                </div>
              )}
              {(detail.anomaly.status === 'confirmed' || detail.anomaly.status === 'dismissed') && (
                <button onClick={() => onReview('revert')} disabled={submitting} className="btn-danger w-full gap-1.5">
                  <RotateCcw className="w-4 h-4" />
                  回退此结论（恢复为上一状态）
                </button>
              )}

              {detail.history.length > 0 && (
                <div>
                  <h3 className="font-medium text-gray-900 text-sm mb-2 flex items-center gap-1.5">
                    <History className="w-4 h-4 text-gray-500" />
                    审核历史
                  </h3>
                  <ol className="relative border-l-2 border-gray-200 ml-2 space-y-3">
                    {detail.history.map((h, i) => (
                      <li key={i} className="pl-4">
                        <div className="absolute -left-1.5 top-1.5 w-3 h-3 rounded-full bg-primary-500 border-2 border-white shadow" />
                        <div className="text-sm">
                          <div className="flex items-center gap-2">
                            <AnomalyStatusBadge status={h.new_status} />
                            <span className="text-xs text-gray-500">{h.operator || '管理员'} · {new Date(h.created_at).toLocaleString('zh-CN')}</span>
                          </div>
                          {h.note && <p className="text-xs text-gray-600 mt-1">{h.note}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
