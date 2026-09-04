import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'network.mesh.os',
  appName: 'Mesh·OS',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: 'Scanning for nearby Mesh·OS field nodes...',
        cancel: 'Cancel',
        availableDevices: 'Available Mesh Nodes',
        noDeviceFound: 'No emergency nodes in radio range',
      },
    },
  },
};

export default config;
