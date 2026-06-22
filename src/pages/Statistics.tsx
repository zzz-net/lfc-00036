import { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import {
  BarChart3,
  TrendingUp,
  Download,
  Users,
  AlertTriangle,
} from 'lucide-react';
import { api, downloadCsv } from '@/lib/api';
import { useAppStore } from '@/store/appStore';
import type { AnomalyFilters, TrendDataPoint, DistributionDataPoint } from '@shared/types';

export default function Statistics() {
  const addToast = useAppStore(s => s.addToast);
  const [grades, setGrades] = useState<string[]>([]);
  const [filters, setFilters] = useState<AnomalyFilters>({});
  const [trend, setTrend] = useState<TrendDataPoint[]>([]);
  const [distribution, setDistribution] = useState<DistributionDataPoint[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.students.grades().then(setGrades);
  }, []);

  useEffect(() => {
    loadData();
  }, [filters]);

  async function loadData() {
    setLoading(true);
    try {
      const [t, d, c] = await Promise.all([
        api.statistics.trend({ grade: filters.grade, class_name: filters.class_name }),
        api.statistics.distribution({ grade: filters.grade, start_date: filters.start_date, end_date: filters.end_date }),
        api.anomalies.counts(),
      ]);
      setTrend(t);
      setDistribution(d);
      setCounts(c);
    } catch (e: any) {
      addToast('error', e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function onExportSummary() {
    setExporting(true);
    try {
      const csv = await api.export.summary(filters);
      downloadCsv(csv, `班级汇总_${Date.now()}.csv`);
      addToast('success', '导出成功');
    } catch (e: any) {
      addToast('error', e.message || '导出失败');
    } finally {
      setExporting(false);
    }
  }

  const total = counts.pending + counts.confirmed + counts.reverted + counts.dismissed || 0;

  const trendOption = {
    title: {
      text: '异常数量趋势',
      left: 0,
      textStyle: { fontSize: 14, fontWeight: 600, color: '#1f2937' },
    },
    tooltip: { trigger: 'axis' },
    legend: { data: ['迟到', '缺勤', '重复刷卡', '请假例外'], top: 0, right: 0 },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: trend.map(t => t.date),
      axisLabel: { color: '#6b7280', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#6b7280', fontSize: 11 },
      splitLine: { lineStyle: { color: '#f3f4f6' } },
    },
    series: [
      { name: '迟到', type: 'line', smooth: true, data: trend.map(t => t.late), itemStyle: { color: '#f59e0b' }, areaStyle: { opacity: 0.1 } },
      { name: '缺勤', type: 'line', smooth: true, data: trend.map(t => t.absent), itemStyle: { color: '#ef4444' }, areaStyle: { opacity: 0.1 } },
      { name: '重复刷卡', type: 'line', smooth: true, data: trend.map(t => t.duplicate_swipe), itemStyle: { color: '#8b5cf6' }, areaStyle: { opacity: 0.1 } },
      { name: '请假例外', type: 'line', smooth: true, data: trend.map(t => t.leave_exception), itemStyle: { color: '#0ea5e9' }, areaStyle: { opacity: 0.1 } },
    ],
  };

  const distOption = {
    title: {
      text: '班级异常分布',
      left: 0,
      textStyle: { fontSize: 14, fontWeight: 600, color: '#1f2937' },
    },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['迟到', '缺勤', '重复刷卡', '请假例外'], top: 0, right: 0 },
    grid: { left: 40, right: 20, top: 40, bottom: 60 },
    xAxis: {
      type: 'category',
      data: distribution.map(d => `${d.grade}${d.class_name}`),
      axisLabel: { color: '#6b7280', fontSize: 11, rotate: 30 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#6b7280', fontSize: 11 },
      splitLine: { lineStyle: { color: '#f3f4f6' } },
    },
    series: [
      { name: '迟到', type: 'bar', stack: 'total', data: distribution.map(d => d.type_breakdown.late), itemStyle: { color: '#f59e0b' } },
      { name: '缺勤', type: 'bar', stack: 'total', data: distribution.map(d => d.type_breakdown.absent), itemStyle: { color: '#ef4444' } },
      { name: '重复刷卡', type: 'bar', stack: 'total', data: distribution.map(d => d.type_breakdown.duplicate_swipe), itemStyle: { color: '#8b5cf6' } },
      { name: '请假例外', type: 'bar', stack: 'total', data: distribution.map(d => d.type_breakdown.leave_exception), itemStyle: { color: '#0ea5e9' } },
    ],
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-gray-900">统计报表</h1>
          <p className="mt-1 text-sm text-gray-500">查看考勤异常趋势和班级分布，导出汇总供班主任核对</p>
        </div>
        <button onClick={onExportSummary} disabled={exporting} className="btn-primary gap-2">
          <Download className="w-4 h-4" />
          {exporting ? '导出中...' : '导出班级汇总 CSV'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">异常总数</p>
              <p className="mt-1 font-display text-3xl font-bold text-gray-900">{total}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">待处理</p>
              <p className="mt-1 font-display text-3xl font-bold text-amber-600">{counts.pending || 0}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-amber-500" />
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">已确认</p>
              <p className="mt-1 font-display text-3xl font-bold text-emerald-600">{counts.confirmed || 0}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-emerald-500" />
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">班级数</p>
              <p className="mt-1 font-display text-3xl font-bold text-gray-900">{distribution.length}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-500" />
            </div>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">筛选条件</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label">年级</label>
            <select
              className="select"
              value={filters.grade || ''}
              onChange={e => setFilters({ ...filters, grade: e.target.value || undefined })}
            >
              <option value="">全部年级</option>
              {grades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="label">开始日期</label>
            <input
              type="date"
              className="input"
              value={filters.start_date || ''}
              onChange={e => setFilters({ ...filters, start_date: e.target.value || undefined })}
            />
          </div>
          <div>
            <label className="label">结束日期</label>
            <input
              type="date"
              className="input"
              value={filters.end_date || ''}
              onChange={e => setFilters({ ...filters, end_date: e.target.value || undefined })}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card p-12 text-center text-gray-400">加载中...</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="card p-5">
            <ReactECharts option={trendOption} style={{ height: 320 }} notMerge />
          </div>
          <div className="card p-5">
            <ReactECharts option={distOption} style={{ height: 320 }} notMerge />
          </div>
        </div>
      )}

      {distribution.length > 0 && (
        <div className="card p-5">
          <h2 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-gray-500" />
            班级异常明细
          </h2>
          <div className="overflow-auto max-h-80">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">年级班级</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600">迟到</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600">缺勤</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600">重复刷卡</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600">请假例外</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600">合计</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {distribution.map((d, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{d.grade} {d.class_name}</td>
                    <td className="px-4 py-2.5 text-right text-amber-600 font-mono">{d.type_breakdown.late}</td>
                    <td className="px-4 py-2.5 text-right text-red-600 font-mono">{d.type_breakdown.absent}</td>
                    <td className="px-4 py-2.5 text-right text-purple-600 font-mono">{d.type_breakdown.duplicate_swipe}</td>
                    <td className="px-4 py-2.5 text-right text-sky-600 font-mono">{d.type_breakdown.leave_exception}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-gray-900 font-mono">{d.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
