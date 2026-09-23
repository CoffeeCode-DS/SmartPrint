export default function Card({ className = '', children, hoverable = false, ...props }) {
  return (
    <div
      className={`rounded-2xl bg-slate-900/85 backdrop-blur-2xl border border-slate-700/80 shadow-[0_12px_36px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.08)] text-slate-100 ${
        hoverable ? 'transition-all duration-200 hover:border-slate-600 hover:shadow-[0_20px_48px_rgba(0,0,0,0.7),inset_0_1px_0_0_rgba(255,255,255,0.15)] hover:-translate-y-0.5' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
