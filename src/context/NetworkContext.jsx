/**
 * Network connectivity context.
 * When coming back online: runs reconnect callback (e.g. push offline queue + sync) first,
 * then sets isOnline so screens refetch after backend is updated.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';

const NetworkContext = createContext({
  isOnline: true,
  isSyncingAfterReconnect: false,
  onReconnect: null,
});

export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used within NetworkProvider');
  return ctx;
}

export function NetworkProvider({ children }) {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncingAfterReconnect, setIsSyncingAfterReconnect] = useState(false);
  const reconnectCallbackRef = useRef(null);

  const onReconnect = useCallback((fn) => {
    reconnectCallbackRef.current = fn;
    return () => {
      reconnectCallbackRef.current = null;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected === true;
      const reachable = state.isInternetReachable;
      const online = connected && (reachable === true || reachable === null);

      if (!online) {
        setIsOnline(false);
        setIsSyncingAfterReconnect(false);
        return;
      }

      setIsOnline((prev) => {
        if (prev === false && online) {
          const run = async () => {
            setIsSyncingAfterReconnect(true);
            try {
              const fn = reconnectCallbackRef.current;
              if (typeof fn === 'function') {
                const result = fn();
                if (result && typeof result.then === 'function') await result;
              }
            } catch (e) {
              console.warn('Reconnect sync error:', e);
            } finally {
              setIsSyncingAfterReconnect(false);
              setIsOnline(true);
            }
          };
          run();
          return false;
        }
        return online;
      });
    });

    NetInfo.fetch().then((state) => {
      const connected = state.isConnected === true;
      const reachable = state.isInternetReachable;
      setIsOnline(connected && (reachable === true || reachable === null));
    }).catch(() => setIsOnline(false));

    return () => unsubscribe();
  }, []);

  return (
    <NetworkContext.Provider value={{ isOnline, isSyncingAfterReconnect, onReconnect }}>
      {children}
    </NetworkContext.Provider>
  );
}
