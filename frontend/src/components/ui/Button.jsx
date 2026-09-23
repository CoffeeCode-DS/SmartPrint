const VARIANTS = {
  primary: 'bg-white text-slate-950 hover:bg-slate-100 font-bold shadow-md shadow-white/10 active:scale-[0.98]',
  seal: 'bg-gradient-to-r from-rose-600 via-rose-500 to-rose-600 hover:from-rose-500 hover:to-rose-400 text-white font-bold shadow-lg shadow-rose-600/30 border border-rose-400/30 active:scale-[0.98]',
  ghost: 'bg-transparent text-slate-300 hover:text-white hover:bg-slate-800/70',
  outline: 'bg-slate-800/80 text-slate-100 border border-slate-600/90 hover:bg-slate-700 hover:border-slate-500 hover:text-white shadow-xs',
  danger: 'bg-rose-500/15 text-rose-300 border border-rose-500/40 hover:bg-rose-500/25',
  emerald: 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold shadow-lg shadow-emerald-600/25 border border-emerald-400/30',
  cyan: 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold shadow-lg shadow-cyan-600/25 border border-cyan-400/30',
  indigo: 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold shadow-lg shadow-indigo-600/25 border border-indigo-400/30',
};

const SIZES = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3.5 text-[15px]',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium tracking-tight transition-all duration-150 ease-out disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98] cursor-pointer ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
