const { detectLanIp } = require('../src/utils/network');

describe('detectLanIp', () => {
  test('returns either null or a plausible IPv4 address, never "localhost" or internal', () => {
    const ip = detectLanIp();
    if (ip !== null) {
      expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      expect(ip).not.toBe('127.0.0.1');
    }
  });
});

describe('PUBLIC_URL resolution (config/env.js)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('an explicit PUBLIC_URL always wins, even over a customized FRONTEND_URL', () => {
    process.env.FRONTEND_URL = 'http://192.168.1.50:5173';
    process.env.PUBLIC_URL = 'https://my-tunnel.ngrok.io';
    const env = require('../src/config/env');
    expect(env.PUBLIC_URL).toBe('https://my-tunnel.ngrok.io');
  });

  test('a customized FRONTEND_URL (not the literal default) is used as PUBLIC_URL when no override is set', () => {
    delete process.env.PUBLIC_URL;
    process.env.FRONTEND_URL = 'http://192.168.1.50:5173';
    const env = require('../src/config/env');
    expect(env.PUBLIC_URL).toBe('http://192.168.1.50:5173');
  });

  test('leaving everything at the default either auto-detects a LAN IP or safely falls back to the default', () => {
    delete process.env.PUBLIC_URL;
    process.env.FRONTEND_URL = 'http://localhost:5173';
    const env = require('../src/config/env');
    expect(
      env.PUBLIC_URL === 'http://localhost:5173' || /^http:\/\/\d+\.\d+\.\d+\.\d+:5173$/.test(env.PUBLIC_URL)
    ).toBe(true);
  });

  test('ALLOWED_ORIGINS includes both FRONTEND_URL and PUBLIC_URL, de-duplicated', () => {
    delete process.env.PUBLIC_URL;
    process.env.FRONTEND_URL = 'http://192.168.1.50:5173';
    const env = require('../src/config/env');
    expect(env.ALLOWED_ORIGINS).toContain('http://192.168.1.50:5173');
    expect(new Set(env.ALLOWED_ORIGINS).size).toBe(env.ALLOWED_ORIGINS.length);
  });
});
