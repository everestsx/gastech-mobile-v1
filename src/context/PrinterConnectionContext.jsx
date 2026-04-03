import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';
import {
  DEFAULT_THERMAL_WIDTH_DOTS,
  connectToRongtaPrinter,
  disconnectRongtaPrinter,
  getStoredBluetoothPrinter,
  isRongtaNativeAvailable,
  setStoredBluetoothPrinter,
} from '../services/printerService';

const PrinterConnectionContext = createContext(null);

export function usePrinterConnection() {
  const ctx = useContext(PrinterConnectionContext);
  if (!ctx) {
    throw new Error('usePrinterConnection must be used within PrinterConnectionProvider');
  }
  return ctx;
}

export function PrinterConnectionProvider({ children }) {
  const rongtaReady = Platform.OS === 'android' && isRongtaNativeAvailable();
  const [thermalPrinter, setThermalPrinterState] = useState(null);
  const [thermalConnected, setThermalConnected] = useState(false);
  const [connectingThermal, setConnectingThermal] = useState(false);
  const [connectThermalError, setConnectThermalError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!rongtaReady) return;
      const stored = await getStoredBluetoothPrinter();
      if (!cancelled && stored) {
        setThermalPrinterState({
          ...stored,
          limitWidthDots: stored.limitWidthDots || DEFAULT_THERMAL_WIDTH_DOTS,
          textAlign: stored.textAlign || 'center',
        });
        setThermalConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rongtaReady]);

  const applyPrinter = useCallback(async (next) => {
    await disconnectRongtaPrinter();
    setThermalPrinterState(next);
    setThermalConnected(false);
    setConnectThermalError(null);
    if (next?.address) {
      await setStoredBluetoothPrinter(next);
    } else {
      await setStoredBluetoothPrinter(null);
    }
  }, []);

  const clearPrinter = useCallback(async () => {
    await disconnectRongtaPrinter();
    setThermalPrinterState(null);
    setThermalConnected(false);
    setConnectThermalError(null);
    await setStoredBluetoothPrinter(null);
  }, []);

  const selectPrinter = useCallback(
    async (row) => {
      const next = {
        name: row.name,
        address: row.address,
        mac: row.mac || row.address,
        limitWidthDots: DEFAULT_THERMAL_WIDTH_DOTS,
        textAlign: 'center',
      };
      await applyPrinter(next);
    },
    [applyPrinter]
  );

  const connect = useCallback(async () => {
    if (!thermalPrinter?.address) {
      throw new Error('Select a paired printer first.');
    }
    setConnectingThermal(true);
    setConnectThermalError(null);
    try {
      await connectToRongtaPrinter(thermalPrinter);
      setThermalConnected(true);
    } catch (e) {
      setThermalConnected(false);
      const msg = e?.message || 'Could not connect.';
      setConnectThermalError(msg);
      throw e;
    } finally {
      setConnectingThermal(false);
    }
  }, [thermalPrinter]);

  const value = useMemo(
    () => ({
      rongtaReady,
      thermalPrinter,
      thermalConnected,
      connectingThermal,
      connectThermalError,
      selectPrinter,
      clearPrinter,
      connect,
    }),
    [
      rongtaReady,
      thermalPrinter,
      thermalConnected,
      connectingThermal,
      connectThermalError,
      selectPrinter,
      clearPrinter,
      connect,
    ]
  );

  return (
    <PrinterConnectionContext.Provider value={value}>{children}</PrinterConnectionContext.Provider>
  );
}
