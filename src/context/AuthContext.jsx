import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getUserSession, saveUserSession, logout as logoutService } from '../services/sync.service';

const AuthContext = createContext({
  user: null,
  vehicleId: null,
  vehicleName: null,
  isAdmin: false,
  loading: true,
  logout: () => {},
  refreshSession: () => {},
});

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    const session = await getUserSession();
    setUser(session);
  }, []);

  useEffect(() => {
    refreshSession().finally(() => setLoading(false));
  }, [refreshSession]);

  const logout = useCallback(async () => {
    await logoutService();
    setUser(null);
  }, []);

  const value = {
    user,
    vehicleId: user?.role === 'vehicle' ? user.vehicle_id : null,
    vehicleName: user?.role === 'vehicle' ? user.vehicle_name : null,
    isAdmin: user?.role === 'admin',
    loading,
    logout,
    refreshSession,
    setUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
