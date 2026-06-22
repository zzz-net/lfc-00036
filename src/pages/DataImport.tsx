import { useRef, useState } from 'react';
import {
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  X,
  Download,
  FileSpreadsheet,
  UserPlus,
} from 'lucide-react';
import { api, parseCsv, downloadCsv } from '@/lib/api';
import { useAppStore } from '@/store/appStore';
import type { ImportError } from '@shared/types';

type TabType = 'swipe' | 'leave' | 'student';

const tabConfig: Record<TabType, { label: string; icon: typeof FileText; desc: string }> = {
  swipe: { label: '门禁刷卡记录', icon: FileSpreadsheet, desc: 'CSV 字段：学号、刷卡时间（如 2025-06-20 08:15:00）、设备位置（可选）' },
  leave: { label: '请假记录', icon: FileText, desc: 'CSV 字段：学号、请假类型、开始时间、结束时间、事由（可选）' },
  student: { label: '学生信息', icon: UserPlus, desc: 'CSV 字段：学号、姓名、年级、班级（用于更新学生名册）' },
};

const errorColor: Record<ImportError['error_type'], string> = {
  unknown_student: 'bg-red-50 text-red-700 border-red-200',
  invalid_time: 'bg-orange-50 text-orange-700 border-orange-200',
  duplicate_record: 'bg-purple-50 text-purple-700 border-purple-200',
  missing_field: 'bg-amber-50 text-amber-700 border-amber-200',
  invalid_format: 'bg-pink-50 text-pink-700 border-pink-200',
};

const errorLabel: Record<ImportError['error_type'], string> = {
  unknown_student: '未知学生',
  invalid_time: '非法时间',
  duplicate_record: '重复记录',
  missing_field: '字段缺失',
  invalid_format: '格式错误',
};

export default function DataImport() {
  const addToast = useAppStore(s => s.addToast);
  const [tab, setTab] = useState<TabType>('swipe');
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [rawData, setRawData] = useState<Record<string, unknown>[]>([]);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [validCount, setValidCount] = useState(0);
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    setFileName('');
    setRawData([]);
    setErrors([]);
    setValidCount(0);
    setResultMsg('');
  }

  async function handleFile(file: File) {
    resetState();
    setFileName(file.name);
    const text = await file.text();
    const rows = parseCsv(text);
    setRawData(rows);
    setValidating(true);
    try {
      let r: { valid_records: number; errors: ImportError[] };
      if (tab === 'swipe') r = await api.import.validateSwipes(rows);
      else if (tab === 'leave') r = await api.import.validateLeaves(rows);
      else r = await api.students.import(rows).then(res => ({ valid_records: res.imported, errors: [] }));
      setValidCount(r.valid_records);
      setErrors(r.errors);
    } catch (e) {
      addToast('error', '校验失败');
    } finally {
      setValidating(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  async function onCommit() {
    if (rawData.length === 0) return;
    setCommitting(true);
    try {
      if (tab === 'swipe') {
        const r = await api.import.commitSwipes(rawData);
        setResultMsg(`成功导入 ${r.imported} 条刷卡记录，识别到 ${r.anomalies_detected} 个异常`);
      } else if (tab === 'leave') {
        const r = await api.import.commitLeaves(rawData);
        setResultMsg(`成功导入 ${r.imported} 条请假记录，重新识别到 ${r.anomalies_detected} 个异常`);
      } else {
        const r = await api.students.import(rawData);
        setResultMsg(`成功导入/更新 ${r.imported} 名学生信息`);
      }
      addToast('success', '导入成功');
    } catch (e: any) {
      addToast('error', e.message || '导入失败');
    } finally {
      setCommitting(false);
    }
  }

  function downloadTemplate() {
    const templates: Record<TabType, string> = {
      swipe: '学号,刷卡时间,设备位置\nS00001,2025-06-20 08:10:00,校门口\n',
      leave: '学号,请假类型,开始时间,结束时间,理由\nS00001,sick,2025-06-20 08:00:00,2025-06-20 17:00:00,感冒发烧\n',
      student: '学号,姓名,年级,班级\nS00001,张三,高一,1班\n',
    };
    downloadCsv(templates[tab], `模板_${tabConfig[tab].label}.csv`);
  }

  const cfg = tabConfig[tab];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="font-display text-2xl font-bold text-gray-900">数据导入</h1>
        <p className="mt-1 text-sm text-gray-500">上传门禁刷卡记录、请假记录或学生信息，系统会自动校验并识别异常</p>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {(Object.keys(tabConfig) as TabType[]).map(k => {
          const TabIcon = tabConfig[k].icon;
          return (
            <button
              key={k}
              onClick={() => { setTab(k); resetState(); }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === k
                  ? 'border-primary-500 text-primary-500'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <TabIcon className="w-4 h-4" />
                {tabConfig[k].label}
              </div>
            </button>
          );
        })}
      </div>

      <div className="card p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-medium text-gray-900">上传 {cfg.label}</h2>
            <p className="text-sm text-gray-500 mt-1">{cfg.desc}</p>
          </div>
          <button onClick={downloadTemplate} className="btn-secondary gap-2">
            <Download className="w-4 h-4" />
            下载模板
          </button>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
            dragOver
              ? 'border-primary-400 bg-primary-50'
              : 'border-gray-300 hover:border-gray-400 bg-gray-50 hover:bg-gray-100'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
          <div className="w-14 h-14 mx-auto rounded-2xl bg-white border border-gray-200 flex items-center justify-center mb-3 shadow-sm">
            <Upload className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-sm text-gray-700 font-medium">
            {fileName ? fileName : '点击或拖拽 CSV 文件到此处'}
          </p>
          <p className="text-xs text-gray-400 mt-1">仅支持 .csv 格式</p>
        </div>

        {(validating || validCount > 0 || errors.length > 0) && (
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="rounded-xl p-4 bg-emerald-50 border border-emerald-200 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-emerald-900">有效记录</p>
                <p className="text-2xl font-bold text-emerald-700">{validating ? '校验中...' : validCount}</p>
              </div>
            </div>
            <div className="rounded-xl p-4 bg-red-50 border border-red-200 flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-red-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-900">错误记录</p>
                <p className="text-2xl font-bold text-red-700">{errors.length}</p>
              </div>
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-gray-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500" />
                错误详情（系统将跳过这些行，不会混入有效数据）
              </h3>
            </div>
            <div className="max-h-80 overflow-auto border border-gray-200 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">行号</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">学号</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">错误类型</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {errors.map((err, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-red-600 font-mono font-medium">第 {err.row_number} 行</td>
                      <td className="px-4 py-2.5 font-mono text-gray-700">{err.student_id || '-'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`badge border ${errorColor[err.error_type]}`}>
                          {errorLabel[err.error_type]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{err.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {resultMsg && (
          <div className="mt-4 rounded-xl p-4 bg-emerald-50 border border-emerald-200 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <p className="text-sm text-emerald-800">{resultMsg}</p>
          </div>
        )}

        {rawData.length > 0 && !resultMsg && (
          <div className="mt-6 flex justify-end gap-3">
            <button onClick={resetState} className="btn-secondary">
              <X className="w-4 h-4 mr-1.5" />
              取消
            </button>
            <button
              onClick={onCommit}
              disabled={committing || validCount === 0}
              className="btn-primary"
            >
              {committing ? '导入中...' : `确认导入 ${validCount} 条记录`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
