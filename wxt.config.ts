import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// Dev builds pin the extension ID with `key` (stable ID across machines, so
// the Google OAuth redirect URI stays the same while developing). The Chrome
// Web Store rejects packages containing `key`, so `npm run zip` sets
// STORE_BUILD=1 and leaves it out.
const DEV_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvTUtNogs/adg3k678c3hG3mXGq6ZIBVt9QNgzDBmccyBwESD6uj2PmP3g80ZEkQhXZofwDjR+4bVcCgyG87zsphLT6PETYZDyfkHQGZ+PWCc8k94NEIKm+cfNb6Bc0Wrubr//8ewAP1HXxD46j/ia4+peCYr6s/w7RgXfhHNFzimfHDLKpxdmXCqbz1SVb829KpIUzRObg6tdBSAN/ze5Cf39xVmgZgcs7vpQB6cbqbPy3zSjO5My0Wf0umsXZ2hs/9/nHP4Tzuv1cl+mkseXryEUjV7ZaempRiFymYXvfrvBC9ls7wDb0/FppjCL4/PiS0VVQ8UI+vIdWcpxEV6gQIDAQAB';

export default defineConfig({
  // Visible output folder (not .output) so it's easy to pick in Chrome's "Load unpacked" dialog.
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Smart Tasks: To-Do List & Reminders',
    short_name: 'Smart Tasks',
    version: '1.8.5',
    description:
      'Capture tasks in a click, get reminders on time and stay in sync on every device. Works with AI agents like Claude.',
    minimum_chrome_version: '116',
    permissions: ['storage', 'identity', 'alarms', 'notifications', 'contextMenus', 'offscreen'],
    // Loopback only: asks the Smart Tasks Windows app (if running) whether it is
    // showing notifications, so they don't pop up twice. See lib/desktop.ts.
    host_permissions: ['http://127.0.0.1/*'],
    action: { default_title: 'Smart Tasks' },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' },
        description: 'Open Smart Tasks',
      },
    },
    icons: {
      '16': 'icon/16.png',
      '32': 'icon/32.png',
      '48': 'icon/48.png',
      '128': 'icon/128.png',
    },
    ...(process.env.STORE_BUILD ? {} : { key: DEV_KEY }),
  },
});
