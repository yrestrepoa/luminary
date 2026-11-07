import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { authApi, usersApi, setUnauthorizedHandler } from '../services/api/index.js';

export const AuthContext = createContext(null);

/**
 * Estado de sesión. status: 'loading' (verificando cookie) | 'authenticated' | 'anonymous'.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  const applyUser = useCallback((u) => {
    setUser(u);
    setStatus(u ? 'authenticated' : 'anonymous');
    return u;
  }, []);

  useEffect(() => {
    // Cualquier 401 de la API invalida la sesión local.
    setUnauthorizedHandler(() => applyUser(null));
    authApi
      .getMe()
      .then(applyUser)
      .catch(() => applyUser(null));
    return () => setUnauthorizedHandler(null);
  }, [applyUser]);

  const login = useCallback((email, password) => authApi.login(email, password).then(applyUser), [applyUser]);
  const register = useCallback((data) => authApi.register(data).then(applyUser), [applyUser]);
  const updateProfile = useCallback((data) => usersApi.updateProfile(data).then(applyUser), [applyUser]);
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      applyUser(null);
    }
  }, [applyUser]);

  const value = useMemo(
    () => ({ user, status, isAuthenticated: status === 'authenticated', login, register, logout, updateProfile }),
    [user, status, login, register, logout, updateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
