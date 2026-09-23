import { Link } from 'react-router-dom';
import SmartPrintLogo from '../components/SmartPrintLogo';

const FLOW_STEPS = [
  { label: '1. Scan', sub: 'Camera QR', delay: '0s' },
  { label: '2. Ingest', sub: 'PDF & DOCX', delay: '1.5s' },
  { label: '3. Print', sub: 'LaserJet Pro', delay: '3s' },
  { label: '4. Shred', sub: 'Zero-Trace', delay: '4.5s' },
];

function ScanIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 15h3v3h-3zM19 14v2M14 19h2" />
    </svg>
  );
}
function UploadIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 16V5M7 10l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 19h16" strokeLinecap="round" />
    </svg>
  );
}
function PrintIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M6 9V4h12v5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="9" width="16" height="7" rx="1.5" />
      <path d="M6 16v4h12v-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function EraseIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}
const ICONS = [ScanIcon, UploadIcon, PrintIcon, EraseIcon];

export default function Landing() {
  return (
    <div className="min-h-screen app-gradient-canvas text-slate-100 relative overflow-hidden font-sans">
      {/* Ambient background light orbs */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[65rem] h-[38rem] bg-gradient-to-b from-rose-500/20 via-indigo-500/15 to-transparent blur-[140px] pointer-events-none" />
      <div className="absolute top-1/3 -right-32 w-[28rem] h-[28rem] bg-cyan-500/12 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-20 -left-32 w-[28rem] h-[28rem] bg-emerald-500/12 blur-[130px] pointer-events-none" />

      {/* Navigation Header */}
      <header className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between border-b border-slate-700/80 relative z-10">
        <div className="flex items-center gap-3">
          <Link to="/" className="inline-block transition-transform hover:scale-[1.02]">
            <SmartPrintLogo size="md" showText={true} />
          </Link>
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono bg-emerald-950/70 text-emerald-300 px-3 py-1 rounded-full border border-emerald-500/40 font-semibold shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Campus Demo LaserJet Connected</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden md:inline-block text-xs text-slate-300 font-mono bg-slate-900/80 border border-slate-700 px-3 py-1.5 rounded-xl shadow-xs">
            Staff Demo: <code className="text-white font-bold bg-slate-800 px-1.5 py-0.5 rounded">admin / changeme123</code>
          </span>
          <Link
            to="/signup"
            className="text-xs font-semibold px-4 py-2 rounded-xl border border-rose-500/50 bg-rose-950/60 hover:bg-rose-900/80 text-rose-200 transition-all shadow-md shadow-rose-950/30"
          >
            Sign Up
          </Link>
          <Link
            to="/login"
            className="text-xs font-semibold px-4 py-2 rounded-xl border border-slate-600 bg-slate-900/90 hover:bg-slate-800 text-white transition-all shadow-md"
          >
            Staff Sign In →
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 pt-16 pb-24 grid lg:grid-cols-12 gap-12 items-center relative z-10">
        <div className="lg:col-span-7 text-left">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-rose-500/40 text-xs font-semibold text-rose-300 mb-6 shadow-md shadow-rose-950/20">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span>Multi-Page PDF & Native Word (.DOCX) Preview Engine</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.08] tracking-tight text-white">
            Send it to the printer.{' '}
            <span className="block bg-gradient-to-r from-rose-400 via-pink-300 to-indigo-300 bg-clip-text text-transparent">
              Not to their downloads folder.
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-slate-200 leading-relaxed max-w-xl">
            Scan a QR code from any smartphone camera, preview Word documents & PDFs page-by-page, and 1-click print. Your file is automatically purged from memory the second the job leaves the printer tray.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl bg-gradient-to-r from-rose-600 via-rose-500 to-rose-600 hover:from-rose-500 hover:to-rose-400 text-white font-bold text-sm sm:text-base transition-all shadow-xl shadow-rose-600/30 hover:scale-[1.02] active:scale-[0.98] border border-rose-400/30"
            >
              <span>Launch Print Station</span>
              <span>→</span>
            </Link>
            <Link
              to="/queue"
              className="inline-flex items-center gap-2 px-7 py-4 rounded-2xl border border-slate-700 bg-slate-900/90 hover:bg-slate-800/90 hover:border-slate-500 font-semibold text-sm text-white transition-all shadow-md"
            >
              <span>Operator Queue</span>
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-4 text-xs text-slate-300 font-mono">
            <div className="flex items-center gap-2 bg-slate-900/80 px-3.5 py-2 rounded-xl border border-slate-700/80 shadow-xs">
              <span className="text-emerald-400 font-bold">✓</span>
              <span>Zero-Storage Privacy</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-900/80 px-3.5 py-2 rounded-xl border border-slate-700/80 shadow-xs">
              <span className="text-emerald-400 font-bold">✓</span>
              <span>Native Word & Multi-Page PDF</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-900/80 px-3.5 py-2 rounded-xl border border-slate-700/80 shadow-xs">
              <span className="text-emerald-400 font-bold">✓</span>
              <span>No App Download Needed</span>
            </div>
          </div>
        </div>

        {/* Right Side Visual Device Mockup & Simulated Terminal */}
        <div className="lg:col-span-5">
          <div className="rounded-3xl bg-slate-900/90 backdrop-blur-2xl border border-slate-700/80 p-6 sm:p-7 shadow-[0_16px_50px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.1)] relative overflow-hidden group">
            {/* Card internal glow */}
            <div className="absolute -top-16 -right-16 w-56 h-56 bg-rose-500/25 rounded-full blur-3xl pointer-events-none" />

            <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-700/80">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
                  Live Station Pipeline
                </span>
              </div>
              <span className="text-[11px] font-mono text-emerald-300 bg-emerald-950/80 px-2.5 py-0.5 rounded-full border border-emerald-500/40 font-bold">
                LaserJet Pro Ready
              </span>
            </div>

            {/* 4 Flow Steps */}
            <div className="grid grid-cols-4 gap-3 py-3">
              {FLOW_STEPS.map((step, i) => {
                const Icon = ICONS[i];
                return (
                  <div key={step.label} className="flex flex-col items-center text-center gap-2">
                    <div
                      className="flow-node w-12 h-12 rounded-2xl border border-rose-500/40 bg-slate-800/90 flex items-center justify-center text-rose-300 shadow-md transition-transform group-hover:scale-105"
                      style={{ animationDelay: step.delay }}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold text-xs text-white">{step.label}</p>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">{step.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Simulated Live Stream Terminal */}
            <div className="mt-4 p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 font-mono text-[11px] text-left space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-slate-500 border-b border-slate-800/80 pb-1 mb-1">
                <span>STATION TELEMETRY DAEMON</span>
                <span className="text-emerald-400">● REALTIME</span>
              </div>
              <p className="text-slate-400 flex items-center gap-2">
                <span className="text-indigo-400">[01:28:10]</span>
                <span>QR pairing token issued #sess_492a</span>
              </p>
              <p className="text-slate-400 flex items-center gap-2">
                <span className="text-cyan-400">[01:28:14]</span>
                <span>Ingested: <span className="text-slate-200">Assignment_Final.pdf</span> (2.4 MB)</span>
              </p>
              <p className="text-emerald-400 flex items-center gap-2">
                <span className="text-emerald-400">[01:28:18]</span>
                <span>Spooling &rarr; HP LaserJet (Tray 2, Duplex)</span>
              </p>
              <p className="text-rose-400 flex items-center gap-2 font-bold">
                <span className="text-rose-400">[01:28:22]</span>
                <span>Zero-Trace: RAM wiped, SHA-256 hashed</span>
              </p>
            </div>

            <div className="mt-5 pt-4 border-t border-slate-700/80 flex items-center justify-between text-xs font-mono">
              <span className="flex items-center gap-2 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                <span>Station #DEMO-01</span>
              </span>
              <span className="text-rose-300 bg-rose-950/80 border border-rose-500/40 font-bold px-3 py-1 rounded-xl text-[11px] shadow-xs">
                🔥 Memory Wipe On Job Done
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison Section */}
      <section className="border-y border-slate-700/80 bg-slate-950/60 py-20 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-rose-400 bg-rose-950/70 border border-rose-500/40 px-3.5 py-1 rounded-full shadow-xs">
              Privacy Architecture
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mt-4">
              Why not just WhatsApp it to the print shop?
            </h2>
            <p className="text-slate-300 text-sm sm:text-base mt-3">
              Traditional print shops leave your private PDFs and ID documents scattered across shared computers.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 text-left">
            {/* The Old Way Card */}
            <div className="rounded-3xl bg-slate-900/80 border border-rose-900/60 p-8 shadow-xl">
              <div className="flex items-center gap-2.5 text-rose-400 font-mono text-xs font-bold uppercase tracking-wider mb-5">
                <span className="text-base">✕</span>
                <span>The Usual Print Shop Way</span>
              </div>
              <ul className="space-y-4 text-slate-300 text-sm sm:text-base">
                <li className="flex items-start gap-3">
                  <span className="text-rose-500 font-bold mt-0.5">•</span>
                  <span>Sits in WhatsApp/Telegram chat history indefinitely.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-rose-500 font-bold mt-0.5">•</span>
                  <span>Downloaded onto a public shared PC that nobody clears.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-rose-500 font-bold mt-0.5">•</span>
                  <span>Anyone who unlocks the shared PC can reopen and copy it.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-rose-500 font-bold mt-0.5">•</span>
                  <span>Zero audit trail of who accessed or reprinted your documents.</span>
                </li>
              </ul>
            </div>

            {/* The SmartPrint Way Card */}
            <div className="rounded-3xl bg-slate-900/90 border border-emerald-500/50 p-8 shadow-2xl ring-1 ring-emerald-500/20 relative overflow-hidden">
              <div className="absolute -top-12 -right-12 w-48 h-48 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />

              <div className="flex items-center gap-2.5 text-emerald-400 font-mono text-xs font-bold uppercase tracking-wider mb-5">
                <span className="text-base">✓</span>
                <span>The SmartPrint Zero-Trace Way</span>
              </div>
              <ul className="space-y-4 text-slate-100 text-sm sm:text-base">
                <li className="flex items-start gap-3">
                  <span className="text-emerald-400 font-bold mt-0.5">✓</span>
                  <span>Session expires in minutes with cryptographic token destruction.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-emerald-400 font-bold mt-0.5">✓</span>
                  <span>File is wiped from memory & disk the second print finishes.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-emerald-400 font-bold mt-0.5">✓</span>
                  <span>Single-use dynamic QR codes — used once, then permanently invalidated.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-emerald-400 font-bold mt-0.5">✓</span>
                  <span>Every spool event is hash-chained in an immutable SHA-256 ledger.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 4 Steps Flow */}
      <section className="max-w-7xl mx-auto px-6 py-20 text-left relative z-10">
        <h2 className="text-3xl font-extrabold tracking-tight text-white mb-2">
          How it works in 4 simple steps
        </h2>
        <p className="text-slate-300 text-sm mb-12">
          No mobile app download, no account registration, no residual files.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            ['01', 'Scan Station QR', 'Point your phone camera at the station screen to establish a private pairing session.'],
            ['02', 'Upload Instantly', 'Choose any PDF, Word (.docx), or image directly from your mobile files.'],
            ['03', 'Preview & Print', 'Examine documents page-by-page with authentic typography, then tap 1-Click Print.'],
            ['04', 'Zero-Trace Wipe', 'Spooler completes and cryptographic cleanup destroys all traces immediately.'],
          ].map(([num, title, body]) => (
            <div
              key={num}
              className="p-6 rounded-2xl bg-slate-900/85 border border-slate-700/80 shadow-lg hover:border-slate-500 transition-all flex flex-col justify-between"
            >
              <div>
                <span className="font-mono text-xs font-bold text-rose-300 bg-rose-950/80 border border-rose-500/40 px-3 py-1 rounded-lg">
                  {num}
                </span>
                <p className="font-bold text-white text-base mt-4">{title}</p>
                <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="py-20 relative z-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="rounded-3xl bg-gradient-to-r from-rose-950/70 via-slate-900 to-indigo-950/70 border border-rose-500/40 p-10 sm:p-14 text-center sm:text-left flex flex-col sm:flex-row sm:items-center sm:justify-between gap-8 shadow-2xl">
            <div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Ready to experience zero-trace printing?
              </h2>
              <p className="text-slate-300 text-sm sm:text-base mt-2 max-w-md">
                Launch the print station now or sign in to the operator queue.
              </p>
            </div>
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-bold text-sm sm:text-base transition-all shadow-xl shadow-rose-600/30 shrink-0 border border-rose-400/30"
            >
              <span>Launch Station</span>
              <span>→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-8 border-t border-slate-700/80 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-500" />
          <span className="font-bold text-slate-200">SmartPrint</span>
          <span>· Zero Privacy Leakage System</span>
        </div>
        <Link to="/login" className="hover:text-white transition-colors">
          Staff Sign In
        </Link>
      </footer>
    </div>
  );
}
