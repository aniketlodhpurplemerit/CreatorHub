import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  _id: string;
  name: string;
  email: string;
  role: 'user' | 'creator' | 'admin';
  avatar?: string;
  bio?: string;
  countryOfResidence?: string;
  token: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  unreadCount: number;
  login: (userData: User) => void;
  updateUser: (updated: Partial<User>) => void;
  setUnreadCount: (count: number) => void;
  decrementUnread: () => void;
  clearUnread: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      unreadCount: 0,
      login: (userData) => {
        localStorage.setItem('token', userData.token);
        set({ user: userData, token: userData.token });
      },
      updateUser: (updated) => {
        set((state) => {
          if (!state.user) {
            return state;
          }

          const mergedUser = { ...state.user, ...updated };

          if (updated.token) {
            localStorage.setItem('token', updated.token);
          }

          return {
            user: mergedUser,
            token: mergedUser.token || state.token,
          };
        });
      },
      setUnreadCount: (count) => set({ unreadCount: count }),
      decrementUnread: () =>
        set((state) => ({ unreadCount: Math.max(0, state.unreadCount - 1) })),
      clearUnread: () => set({ unreadCount: 0 }),
      logout: () => {
        localStorage.removeItem('token');
        set({ user: null, token: null, unreadCount: 0 });
        window.location.href = '/login/sign-in';
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);
