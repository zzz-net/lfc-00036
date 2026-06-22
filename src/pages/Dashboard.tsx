import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Upload,
  Settings,
  BarChart3,
  ArrowRight,
  Sparkles,
  Database,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/store/appStore';

export default function Dashboard() {
  const navigate = useNavigate();
  const addToast = useAppStore(s => s.addToast);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [studentCount, setStudentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sampling, setSampling] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [students, statusCounts] = await Promise.all([
        api.students.list(),
        api.anomalies.counts().catch(() => ({})),
      ]);
      setStudentCount(students.length);
      setCounts(statusCounts);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function loadSample() {
    setSampling(true);
    try {
      const r = await api.import.sample();
      addToast('success', `成功加载样例数据：${r.students}名学生、${r.swipeRecords}条刷卡、${r.leaveRecords}条请假、${r.anomalies}个异常`);
      await loadData();
    } catch (e) {
      addToast('error', '加载样例数据失败');
    } finally {
      setSampling(false);
    }
  }

  const stats = [
    { label: '在校学生', value: studentCount, icon: Users, color: 'from-blue-500 to-blue-600', bg: 'bg-blue-50', text: 'text-blue-600' },
    { label: '待处理异常', value: counts.pending || 0, icon: AlertTriangle, color: 'from-amber-500 to-orange-500', bg: 'bg-amber-50', text: 'text-amber-600' },
    { label: '已确认异常', value: counts.confirmed || 0, icon: CheckCircle2, color: 'from-emerald-500 to-green-600', bg: 'bg-emerald-50', text: 'text-emerald-600' },
    { label: '已回退/忽略', value: (counts.reverted || 0) + (counts.dismissed || 0), icon: Clock, color: 'from-slate-500 to-gray-600', bg: 'bg-slate-50', text: 'text-slate-600' },
  ];

  const quickActions = [
    { label: '数据导入', desc: '导入门禁刷卡和请假记录', icon: Upload, path: '/import', color: 'bg-primary-500 hover:bg-primary-600' },
    { label: '异常分析', desc: '筛选、复核和处理考勤异常', icon: AlertTriangle, path: '/anomalies', color: 'bg-accent-500 hover:bg-accent-600' },
    { label: '规则配置', desc: '调整各年级迟到缺勤阈值', icon: Settings, path: '/rules', color: 'bg-emerald-600 hover:bg-emerald-700' },
    { label: '统计报表', desc: '查看趋势图表并导出汇总', icon: BarChart3, path: '/reports', color: 'bg-purple-600 hover:bg-purple-700' },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-gray-900">工作台首页</h1>
          <p className="mt-1 text-sm text-gray-500">欢迎使用校园考勤异常分析工作台</p>
        </div>
        <button
          onClick={loadSample}
          disabled={sampling}
          className="btn-primary gap-2"
        >
          <Sparkles className="w-4 h-4" />
          {sampling ? '加载中...' : '加载样例数据'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <div key={i} className="card p-5 card-hover">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">{s.label}</p>
                <p className="mt-2 font-display text-3xl font-bold text-gray-900">
                  {loading ? '...' : s.value}
                </p>
              </div>
              <div className={`w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center`}>
                <s.icon className={`w-6 h-6 ${s.text}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {studentCount === 0 && (
        <div className="card p-8 text-center border-dashed border-2 border-gray-200 bg-gradient-to-br from-gray-50 to-white">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
            <Database className="w-8 h-8 text-primary-500" />
          </div>
          <h3 className="font-display text-lg font-bold text-gray-900 mb-2">暂无数据</h3>
          <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto">
            点击右上角「加载样例数据」可一键体验完整流程，或前往数据导入页上传您的门禁刷卡和请假记录。
          </p>
          <button onClick={() => navigate('/import')} className="btn-primary gap-2">
            <Upload className="w-4 h-4" />
            前往数据导入
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {quickActions.map(a => (
          <button
            key={a.path}
            onClick={() => navigate(a.path)}
            className="card p-5 text-left card-hover group"
          >
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl ${a.color} flex items-center justify-center text-white shadow-sm group-hover:shadow-md transition-shadow`}>
                <a.icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-gray-900">{a.label}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{a.desc}</p>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-primary-500 group-hover:translate-x-1 transition-all" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
