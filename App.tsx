import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider } from './src/context/ThemeContext';
import { SyncProvider } from './src/context/SyncContext';
import { PrinterConnectionProvider } from './src/context/PrinterConnectionContext';

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SyncProvider>
          <PrinterConnectionProvider>
            <AppNavigator />
          </PrinterConnectionProvider>
        </SyncProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
