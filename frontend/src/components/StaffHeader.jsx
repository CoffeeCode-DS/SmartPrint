import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import SmartPrintLogo from './SmartPrintLogo';

const LINKS = [
  { to: '/dashboard', label: 'Print Station', icon: '🖨️' },
  { to: '/queue', label: 'Queue', icon: '📋' },
  { to: '/analytics', label: 'Analytics', icon: '📈' },
  { to: '/audit-logs', label: 'Audit & Staff', icon: '🛡️', adminOnly: true },
];

function initials(name = '') {
  return name.slice(0, 2).toUpperCase() || 'SP';
}

export default function StaffHeader({ current }) {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-2xl border-b border-slate-700/80 shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand & Nav */}
        <div className="flex items-center gap-6 sm:gap-8">
          <Link to="/dashboard" className="flex items-center gap-2 shrink-0 group transition-transform hover:scale-[1.02]">
            <SmartPrintLogo size="md" showText={true} />
          </Link>

          <nav className="hidden sm:flex items-center gap-1.5 p-1 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-inner">
            {LINKS.filter((l) => !l.adminOnly || user?.role === 'ADMIN').map((l) => {
              const isActive = l.label === current;
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  className={`relative px-3.5 py-2 text-xs font-semibold rounded-xl transition-all duration-200 flex items-center gap-1.5 ${
                    isActive
                      ? 'text-white bg-gradient-to-r from-rose-600/90 to-indigo-600/90 shadow-md shadow-rose-950/40 border border-white/20'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <span className="text-xs">{l.icon}</span>
                  <span>{l.label}</span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse ml-0.5" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Live Station Indicator & User Actions */}
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 font-mono text-xs font-semibold shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Station Fleet Active</span>
          </div>

          <div className="hidden sm:flex flex-col items-end leading-tight pl-2">
            <span className="text-xs font-bold text-white tracking-wide">{user?.username || 'Staff Operator'}</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-semibold">
              {user?.role || 'OPERATOR'}
            </span>
          </div>

          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-600 via-pink-600 to-indigo-600 text-white text-xs font-mono font-bold flex items-center justify-center shrink-0 shadow-md shadow-rose-950/50 border border-white/20">
            {initials(user?.username)}
          </div>

          <button
            onClick={logout}
            className="text-xs font-semibold text-slate-300 hover:text-rose-400 transition-colors px-3 py-1.5 rounded-xl border border-slate-700/80 bg-slate-900/60 hover:bg-slate-800 hover:border-slate-600 shadow-xs cursor-pointer"
            title="Log out from console"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Mobile Navigation bar */}
      <div className="sm:hidden flex items-center justify-around px-2 py-2 border-t border-slate-800/80 bg-slate-950/90 text-xs">
        {LINKS.filter((l) => !l.adminOnly || user?.role === 'ADMIN').map((l) => {
          const isActive = l.label === current;
          return (
            <Link
              key={l.to}
              to={l.to}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1 ${
                isActive
                  ? 'text-white bg-rose-600/90 font-bold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <span>{l.icon}</span>
              <span>{l.label}</span>
            </Link>
          );
        })}
      </div>
    </header>
  );
}
