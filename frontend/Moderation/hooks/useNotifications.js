'use client';

import { useEffect, useMemo, useState } from 'react';
import api from '@/src/lib/api';
import { useAuthStore } from '@/src/store/useAuthStore';

/**
 * Moderation notification hook with SSE support.
 * Waits for an auth token before calling the API (avoids 401 spam + forced logout from root layout).
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const stored = localStorage.getItem('token');
    if (!token && !stored) {
      setNotifications([]);
      return undefined;
    }

    let source;

    const loadInitial = async () => {
      try {
        const { data } = await api.get('/moderation/notifications');
        setNotifications(Array.isArray(data) ? data : []);
      } catch {
        setNotifications([]);
      }
    };

    loadInitial();

    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
    const streamToken = token || stored;
    if (!streamToken) {
      return undefined;
    }

    const streamUrl = `${base}/moderation/notifications/stream?token=${encodeURIComponent(streamToken)}`;
    source = new EventSource(streamUrl);

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (Array.isArray(payload)) {
          setNotifications((prev) => {
            const byId = new Map(prev.map((n) => [n._id, n]));
            payload.forEach((n) => byId.set(n._id, n));
            return [...byId.values()].sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
          });
        }
      } catch {
        // ignore malformed payloads
      }
    };

    return () => source?.close();
  }, [token]);

  const markRead = async (id) => {
    try {
      await api.patch(`/moderation/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, isRead: true } : n)));
    } catch {
      // no-op
    }
  };

  const unreadCount = useMemo(() => notifications.filter((n) => !n.isRead).length, [notifications]);

  return { notifications, unreadCount, markRead };
}
