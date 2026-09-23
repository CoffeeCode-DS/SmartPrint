import { useState } from 'react';
import { connectPrinter, refreshPrinters } from '../services/printerApi';
import Button from './ui/Button';
import Input from './ui/Input';

export default function ConnectPrinterModal({ isOpen, onClose, onPrinterAdded }) {
  const [connectionType, setConnectionType] = useState('network'); // network | usb | wifi
  const [printerName, setPrinterName] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [port, setPort] = useState('9100');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      if (connectionType === 'network' || connectionType === 'wifi') {
        if (!ipAddress.trim()) {
          setError('Please enter a printer IP address or hostname.');
          setLoading(false);
          return;
        }
      }

      const res = await connectPrinter({
        type: connectionType === 'usb' ? 'usb' : 'network',
        ip: ipAddress.trim() || undefined,
        port: parseInt(port, 10) || 9100,
        name: printerName.trim() || undefined,
        isDefault,
      });

      const printerObj = res.printer || res;
      setSuccessMsg(`Printer "${printerObj?.name || 'Device'}" added successfully!`);
      if (onPrinterAdded) {
        onPrinterAdded(printerObj);
      }
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      setError(err.message || 'Failed to connect printer.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAutoSearch() {
    setLoading(true);
    setError(null);
    try {
      const printers = await refreshPrinters();
      setSuccessMsg(`Found ${printers.length} printer(s) on this station.`);
      if (onPrinterAdded) onPrinterAdded();
    } catch (err) {
      setError(err.message || 'Error scanning printers.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/85 backdrop-blur-md">
      <div className="bg-slate-900/95 rounded-2xl sm:rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.7)] border border-slate-700/80 w-full max-w-[95vw] sm:max-w-md p-4 sm:p-6 text-slate-100 fade-up max-h-[94vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold tracking-tight text-white">Connect / Add Printer</h3>
            <p className="text-xs text-slate-400 mt-0.5">Add a new local, Wi-Fi or network printer</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Connection Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'network', label: 'Network IP' },
                { id: 'wifi', label: 'Wi-Fi' },
                { id: 'usb', label: 'USB / Auto' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setConnectionType(opt.id)}
                  className={`py-2 px-3 text-xs font-medium rounded-xl border transition-all ${
                    connectionType === opt.id
                      ? 'border-rose-500/80 bg-rose-500/15 text-rose-300 font-semibold shadow-xs'
                      : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Printer Name (Optional)
            </label>
            <Input
              placeholder="e.g. Counter HP LaserJet"
              value={printerName}
              onChange={(e) => setPrinterName(e.target.value)}
            />
          </div>

          {(connectionType === 'network' || connectionType === 'wifi') && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  IP / Hostname
                </label>
                <Input
                  placeholder="192.168.1.100"
                  value={ipAddress}
                  onChange={(e) => setIpAddress(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Port
                </label>
                <Input
                  placeholder="9100"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </div>
            </div>
          )}

          {connectionType === 'usb' && (
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-xs text-slate-400">
              <p className="font-semibold text-white">Auto-detect USB Printers</p>
              <p className="mt-1">
                Make sure your printer is plugged in via USB and powered on. Click "Search for Printers" to detect it.
              </p>
            </div>
          )}

          {/* Set as default toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-4 h-4 rounded accent-rose-500"
            />
            <span className="text-xs font-semibold text-slate-300 group-hover:text-white transition-colors">
              Set as default printer (used for all new print jobs)
            </span>
          </label>

          {error && (
            <div className="p-3 text-xs text-rose-300 bg-rose-950/60 rounded-xl border border-rose-800/80">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="p-3 text-xs text-emerald-300 bg-emerald-950/60 rounded-xl border border-emerald-800/80">
              {successMsg}
            </div>
          )}

          <div className="pt-2 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAutoSearch}
              disabled={loading}
              className="text-slate-300 border-slate-700 hover:text-white"
            >
              🔄 Search for Printers
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading} className="text-slate-400 hover:text-white">
                Cancel
              </Button>
              <Button type="submit" variant="seal" size="sm" disabled={loading}>
                {loading ? 'Connecting…' : '+ Add Printer'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
