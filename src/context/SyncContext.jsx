import React, { createContext, useContext, useState, useEffect } from 'react';
import { setSyncStateListener } from '../services/sync.service';

const SyncContext = createContext(null);

export function useSync() {
  const ctx = useContext(SyncContext);
  return ctx ?? { isSyncing: false };
}

export function SyncProvider({ children }) {
  const [isSyncing, setSyncing] = useState(false);

  useEffect(() => {
    setSyncStateListener((value) => setSyncing(!!value));
    return () => setSyncStateListener(null);
  }, []);

  return (
    <SyncContext.Provider value={{ isSyncing }}>
      {children}
    </SyncContext.Provider>
  );
}
