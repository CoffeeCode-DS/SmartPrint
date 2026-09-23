import { useEffect, useState } from 'react';

/**
 * Ticks down to `expiresAt` (ISO string) once per second.
 * Returns seconds remaining (never negative) and a mm:ss formatted string.
 */
export function useCountdown(expiresAt) {
  const [targetTime, setTargetTime] = useState(expiresAt);
  const [secondsLeft, setSecondsLeft] = useState(() => computeSecondsLeft(expiresAt));

  if (targetTime !== expiresAt) {
    setTargetTime(expiresAt);
    setSecondsLeft(computeSecondsLeft(expiresAt));
  }

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft(computeSecondsLeft(expiresAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return { secondsLeft, formatted, isExpired: secondsLeft <= 0 };
}

function computeSecondsLeft(expiresAt) {
  if (!expiresAt) return 0;
  const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  return Math.max(0, diff);
}
