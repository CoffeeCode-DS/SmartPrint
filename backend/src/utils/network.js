const os = require('os');

/**
 * Finds this machine's LAN IP address (e.g. 192.168.1.23) by scanning
 * network interfaces for the first non-internal IPv4 address. Used so the
 * QR code can point somewhere a phone on the same Wi-Fi can actually
 * reach — "localhost" in a QR code only ever means the phone itself,
 * never the laptop that generated it.
 *
 * Returns null if nothing suitable is found (e.g. no network connection),
 * so callers can fall back to a safe default instead of crashing.
 */
function detectLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

module.exports = { detectLanIp };
