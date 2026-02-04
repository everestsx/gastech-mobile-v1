import React from 'react';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider } from './src/context/ThemeContext';
import { NetworkProvider } from './src/context/NetworkContext';

export default function App() {
  return (
    <ThemeProvider>
      <NetworkProvider>
        <AppNavigator />
      </NetworkProvider>
    </ThemeProvider>
  );
}
