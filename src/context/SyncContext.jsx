import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { setSyncStateListener, setSyncCompleteListener } from '../services/sync.service';

const SyncContext = createContext(null);

export function useSync() {
  const ctx = useContext(SyncContext);
  return ctx ?? { isSyncing: false, syncJustCompleted: false, syncCompleteTimestamp: 0, syncResult: null, syncErrorMessage: null };
}

const RESULT_MODAL_DURATION_MS = 2500;

export function SyncProvider({ children }) {
  const [isSyncing, setSyncing] = useState(false);
  const [syncJustCompleted, setSyncJustCompleted] = useState(false);
  const [syncCompleteTimestamp, setSyncCompleteTimestamp] = useState(0);
  const [syncResult, setSyncResult] = useState(null);
  const [syncErrorMessage, setSyncErrorMessage] = useState(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    setSyncStateListener((value) => setSyncing(!!value));
    return () => setSyncStateListener(null);
  }, []);

  useEffect(() => {
    setSyncCompleteListener((success, errorMessage) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (success) {
        setSyncCompleteTimestamp((t) => t + 1);
        setSyncJustCompleted(true);
        setSyncResult('success');
        setSyncErrorMessage(null);
      } else {
        setSyncResult('failed');
        setSyncErrorMessage(errorMessage || 'Could not sync. Will retry when online.');
      }
      timeoutRef.current = setTimeout(() => {
        setSyncJustCompleted(false);
        setSyncResult(null);
        setSyncErrorMessage(null);
        timeoutRef.current = null;
      }, RESULT_MODAL_DURATION_MS);
    });
    return () => {
      setSyncCompleteListener(null);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <SyncContext.Provider value={{ isSyncing, syncJustCompleted, syncCompleteTimestamp, syncResult, syncErrorMessage }}>
      {children}
    </SyncContext.Provider>
  );
}
