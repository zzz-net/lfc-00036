import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { useAppStore } from '@/store/appStore';

export function Toaster() {
  const { toasts, removeToast } = useAppStore();

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-emerald-500" />,
    error: <XCircle className="w-5 h-5 text-red-500" />,
    info: <Info className="w-5 h-5 text-blue-500" />,
  };

  const colors = {
    success: 'bg-emerald-50 border-emerald-200',
    error: 'bg-red-50 border-red-200',
    info: 'bg-blue-50 border-blue-200',
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-start gap-3 p-3 rounded-lg border shadow-lg animate-slideIn ${colors[t.type]}`}
        >
          {icons[t.type]}
          <p className="flex-1 text-sm text-gray-800">{t.message}</p>
          <button
            onClick={() => removeToast(t.id)}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
