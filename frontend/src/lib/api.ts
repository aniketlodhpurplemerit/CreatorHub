import axios from 'axios';
import { useAuthStore } from '@/src/store/useAuthStore';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api',
});

// Add a request interceptor to add the auth token
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Track consecutive 401s to avoid logging out on transient failures
let consecutiveAuthFailures = 0;
let lastAuthFailureTime = 0;
const AUTH_FAILURE_THRESHOLD = 3;    // require 3 consecutive 401s
const AUTH_FAILURE_WINDOW_MS = 30000; // within 30 seconds

// Handle invalid/expired token globally for protected endpoints
api.interceptors.response.use(
  (response) => {
    // Reset counter on any successful response
    consecutiveAuthFailures = 0;
    return response;
  },
  (error) => {
    if (
      typeof window !== 'undefined' &&
      axios.isAxiosError(error) &&
      error.response?.status === 401
    ) {
      const hasToken = Boolean(localStorage.getItem('token'));
      const requestUrl = error.config?.url || '';
      const isAuthRequest =
        requestUrl.includes('/auth/login') || requestUrl.includes('/auth/register');
      const isBackgroundNotifications =
        requestUrl.includes('/moderation/notifications') ||
        requestUrl.includes('/creator/notifications') ||
        requestUrl.includes('/user/notifications') ||
        requestUrl.includes('/moderation/ban/status');

      if (hasToken && !isAuthRequest && !isBackgroundNotifications) {
        const now = Date.now();
        // Reset counter if last failure was too long ago
        if (now - lastAuthFailureTime > AUTH_FAILURE_WINDOW_MS) {
          consecutiveAuthFailures = 0;
        }
        consecutiveAuthFailures += 1;
        lastAuthFailureTime = now;

        // Only logout after repeated auth failures — not on a single blip
        if (consecutiveAuthFailures >= AUTH_FAILURE_THRESHOLD) {
          consecutiveAuthFailures = 0;
          useAuthStore.getState().logout();
        }
      }
    }

    return Promise.reject(error);
  }
);

export default api;
