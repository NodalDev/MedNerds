import { useEffect, useRef, useState } from 'react';

type WakeState = 'off' | 'requesting' | 'active' | 'suspended' | 'unsupported' | 'error';

export function useDisplayWakeLock() {
  const [state, setState] = useState<WakeState>('off');
  const intent = useRef(false);
  const sentinel = useRef<WakeLockSentinel | null>(null);
  const generation = useRef(0);
  const requesting = useRef(false);

  const request = async () => {
    if (!intent.current || requesting.current || sentinel.current || document.visibilityState !== 'visible') return;
    if (!navigator.wakeLock) { intent.current = false; setState('unsupported'); return; }
    const current = generation.current;
    requesting.current = true;
    setState('requesting');
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (current !== generation.current || !intent.current || document.visibilityState !== 'visible') {
        await lock.release();
        return;
      }
      sentinel.current = lock;
      setState('active');
      lock.addEventListener('release', () => {
        if (sentinel.current !== lock) return;
        sentinel.current = null;
        if (intent.current) setState('suspended');
      }, { once: true });
    } catch {
      if (current === generation.current) {
        intent.current = false;
        setState('error');
      }
    } finally {
      requesting.current = false;
    }
  };

  const toggle = () => {
    if (intent.current) {
      intent.current = false;
      generation.current += 1;
      const lock = sentinel.current;
      sentinel.current = null;
      setState('off');
      if (lock) void lock.release();
    } else {
      intent.current = true;
      void request();
    }
  };

  useEffect(() => {
    const onVisibility = () => {
      if (!intent.current) return;
      if (document.visibilityState === 'visible' && !sentinel.current) void request();
      else if (document.visibilityState !== 'visible') setState('suspended');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      intent.current = false;
      generation.current += 1;
      if (sentinel.current) void sentinel.current.release();
      sentinel.current = null;
    };
  }, []);

  return { state, enabled: intent.current, toggle };
}
