import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { setSyncStateListener, setSyncCompleteListener } from '../services/sync.service';

const SyncContext = createContext(null);

export function useSync() {
  const ctx = useContext(SyncContext);
  return ctx ?? { isSyncing: false, syncJustCompleted: false, syncCompleteTimestamp: 0 };
}

const SUCCESS_MODAL_DURATION_MS = 2500;

export function SyncProvider({ children }) {
  const [isSyncing, setSyncing] = useState(false);
  const [syncJustCompleted, setSyncJustCompleted] = useState(false);
  const [syncCompleteTimestamp, setSyncCompleteTimestamp] = useState(0);
  const timeoutRef = useRef(null);

  useEffect(() => {
    setSyncStateListener((value) => setSyncing(!!value));
    return () => setSyncStateListener(null);
  }, []);

  useEffect(() => {
    setSyncCompleteListener((success) => {
      if (success) {
        setSyncCompleteTimestamp((t) => t + 1);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setSyncJustCompleted(true);
        timeoutRef.current = setTimeout(() => {
          setSyncJustCompleted(false);
          timeoutRef.current = null;
        }, SUCCESS_MODAL_DURATION_MS);
      }
    });
    return () => {
      setSyncCompleteListener(null);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <SyncContext.Provider value={{ isSyncing, syncJustCompleted, syncCompleteTimestamp }}>
      {children}
    </SyncContext.Provider>
  );
}
