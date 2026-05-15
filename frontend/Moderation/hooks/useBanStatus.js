'use client';

import { useEffect, useState } from 'react';
import api from '@/src/lib/api';

let banState = { isBanned: false, ban: null };
const listeners = new Set();

const emit = () => listeners.forEach((listener) => listener({ ...banState }));
const setGlobalBan = (next) => {
  banState = next;
  emit();
};

/**
 * Global ban state hook + fetch interception.
 */
export function useBanStatus() {
  const [state, setState] = useState(banState);

  useEffect(() => {
    const listener = (next) => setState(next);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      if (typeof window !== 'undefined' && !localStorage.getItem('token')) {
        if (mounted) setGlobalBan({ isBanned: false, ban: null });
        return;
      }

      try {
        const { data } = await api.get('/moderation/ban/status');
        if (!mounted) return;
        if (data?.isBanned) {
          setGlobalBan({ isBanned: true, ban: data });
        } else {
          setGlobalBan({ isBanned: false, ban: null });
        }
      } catch {
        if (mounted) setGlobalBan({ isBanned: false, ban: null });
      }
    };

    bootstrap();

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.status === 403) {
        try {
          const cloned = response.clone();
          const payload = await cloned.json();
          if (payload?.isBanned) {
            setGlobalBan({ isBanned: true, ban: payload });
          }
        } catch {
          // ignored
        }
      }
      return response;
    };

    return () => {
      mounted = false;
      window.fetch = originalFetch;
    };
  }, []);

  return {
    isBanned: state.isBanned,
    ban: state.ban,
    clearBan: () => setGlobalBan({ isBanned: false, ban: null }),
  };
}
