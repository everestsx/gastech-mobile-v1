import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { setSyncStateListener, setSyncCompleteListener } from '../services/sync.service';

const SyncContext = createContext(null);

function toFriendlySyncErrorMessage(errorMessage) {
  const raw = (errorMessage || '').toString().trim();
  const msg = raw.toLowerCase();
  if (!raw) return 'Could not sync right now. We will retry automatically when you are online.';

  if (
    msg.includes('sqlite_full') ||
    msg.includes('database or disk is full') ||
    msg.includes('disk is full') ||
    msg.includes('enospc')
  ) {
    return 'This phone is out of storage, so sync could not finish. Free some space, then tap Sync again.';
  }

  const isNetworkLike =
    msg.includes('cannot reach server') ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('request timed out') ||
    msg.includes('timed out') ||
    msg.includes('aborterror') ||
    msg.includes('socket');

  if (isNetworkLike) {
    return 'No internet connection. Your data is saved offline and sync will retry automatically when the connection is back.';
  }

  return 'Could not sync right now. We will retry automatically in the background.';
}

export function useSync() {
  const ctx = useContext(SyncContext);
  return ctx ?? { isSyncing: false, syncJustCompleted: false, syncCompleteTimestamp: 0, syncResult: null, syncErrorMessage: null, hideSyncIndicator: false, setHideSyncIndicator: () => {} };
}

const RESULT_MODAL_DURATION_MS = 2500;

export function SyncProvider({ children }) {
  const [isSyncing, setSyncing] = useState(false);
  const [syncJustCompleted, setSyncJustCompleted] = useState(false);
  const [syncCompleteTimestamp, setSyncCompleteTimestamp] = useState(0);
  const [syncResult, setSyncResult] = useState(null);
  const [syncErrorMessage, setSyncErrorMessage] = useState(null);
  const [hideSyncIndicator, setHideSyncIndicator] = useState(false);
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
        setSyncErrorMessage(toFriendlySyncErrorMessage(errorMessage));
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
    <SyncContext.Provider value={{ isSyncing, syncJustCompleted, syncCompleteTimestamp, syncResult, syncErrorMessage, hideSyncIndicator, setHideSyncIndicator }}>
      {children}
    </SyncContext.Provider>
  );
}
