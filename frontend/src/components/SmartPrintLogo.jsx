export default function SmartPrintLogo({ size = 'md', showText = true, className = '' }) {
  const isSm = size === 'sm';
  const isLg = size === 'lg';

  const iconDimensions = isSm ? 'w-11 h-11' : isLg ? 'w-16 h-16' : 'w-13 h-13 sm:w-14 sm:h-14';
  const titleSize = isSm ? 'text-xl' : isLg ? 'text-3xl' : 'text-2xl';
  const subtitleSize = isSm ? 'text-[10px]' : 'text-xs';

  return (
    <div className={`inline-flex items-center gap-3.5 select-none ${className}`}>
      {/* High-Tech Vector Logo Icon */}
      <div className={`relative ${iconDimensions} shrink-0 group`}>
        {/* Ambient Glow */}
        <div className="absolute inset-0 bg-gradient-to-tr from-rose-600 via-indigo-600 to-cyan-400 rounded-2xl blur-[10px] opacity-80 group-hover:opacity-100 transition-opacity" />
        
        {/* Main Logo Container */}
        <div className="relative w-full h-full rounded-2xl bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 border-2 border-slate-700/90 flex items-center justify-center p-2 shadow-[0_4px_20px_rgba(0,0,0,0.7)] overflow-hidden">
          {/* Subtle Cyber Grid lines */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.07)_1px,transparent_1px)] bg-[size:6px_6px] pointer-events-none" />
          
          <svg viewBox="0 0 32 32" fill="none" className="w-full h-full relative z-10" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="spGrad1" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#f43f5e" />
                <stop offset="50%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#38bdf8" />
              </linearGradient>
              <linearGradient id="spGradPaper" x1="10" y1="4" x2="22" y2="16" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#e2e8f0" />
              </linearGradient>
            </defs>
            
            {/* Top Sheet Feed */}
            <path
              d="M9 4.5C9 3.67 9.67 3 10.5 3H21.5C22.33 3 23 3.67 23 4.5V10H9V4.5Z"
              fill="url(#spGradPaper)"
              className="drop-shadow-xs"
            />
            
            {/* Main Printer Body */}
            <rect
              x="4"
              y="9"
              width="24"
              height="12"
              rx="3"
              fill="#1e293b"
              stroke="url(#spGrad1)"
              strokeWidth="1.8"
            />
            
            {/* Laser Spooler Slot Output */}
            <rect x="8" y="16" width="16" height="2" rx="1" fill="#f43f5e" className="animate-pulse" />
            
            {/* Bottom Printed Page Dispenser */}
            <path
              d="M8 17.5H24V25.5C24 26.33 23.33 27 22.5 27H9.5C8.67 27 8 26.33 8 25.5V17.5Z"
              fill="#0f172a"
              stroke="#64748b"
              strokeWidth="1.2"
            />
            <line x1="11" y1="21" x2="21" y2="21" stroke="#cbd5e1" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="11" y1="24" x2="17" y2="24" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" />
            
            {/* Active Status LED */}
            <circle cx="7" cy="12.5" r="1.3" fill="#10b981" />
          </svg>
        </div>
      </div>

      {/* Typography */}
      {showText && (
        <div className="flex flex-col justify-center leading-none">
          <div className="flex items-center gap-2">
            <span className={`${titleSize} font-black tracking-tight text-white font-sans`}>
              Smart<span className="bg-gradient-to-r from-rose-500 via-pink-400 to-indigo-400 bg-clip-text text-transparent">Print</span>
            </span>
          </div>
          <span className={`${subtitleSize} font-mono tracking-widest text-slate-300 mt-1 uppercase font-semibold hidden sm:block`}>
            Zero-Trace Print Station
          </span>
        </div>
      )}
    </div>
  );
}
