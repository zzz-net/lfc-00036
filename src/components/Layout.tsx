import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Upload,
  AlertTriangle,
  Settings,
  BarChart3,
  GraduationCap,
} from 'lucide-react';
import { Toaster } from './Toast';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: '工作台首页' },
  { path: '/import', icon: Upload, label: '数据导入' },
  { path: '/anomalies', icon: AlertTriangle, label: '异常分析' },
  { path: '/rules', icon: Settings, label: '规则配置' },
  { path: '/reports', icon: BarChart3, label: '统计报表' },
];

export function Layout() {
  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-md">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-primary-500">考勤分析</h1>
              <p className="text-xs text-gray-500">智能异常识别平台</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `nav-link ${isActive ? 'nav-link-active' : ''}`
              }
            >
              <item.icon className="w-4 h-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-100">
          <p className="text-xs text-gray-400 text-center">校园考勤异常分析工作台 v1.0</p>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
          <div className="text-sm text-gray-500">
            <span className="font-medium text-gray-700">教务管理系统</span>
            <span className="mx-2">/</span>
            <span>本地数据处理</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              数据库已连接
            </div>
          </div>
        </header>
        <div className="flex-1 p-6 overflow-auto">
          <Outlet />
        </div>
      </main>
      <Toaster />
    </div>
  );
}
