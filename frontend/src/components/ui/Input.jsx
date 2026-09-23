export default function Input({ className = '', ...props }) {
  return (
    <input
      className={`w-full rounded-xl border border-slate-700 bg-slate-950/90 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-all duration-150 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20 shadow-inner ${className}`}
      {...props}
    />
  );
}
