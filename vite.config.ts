import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves project sites at /<repo>/, so we need the matching base.
// In dev (or other hosts) leave base as '/'.
const base = process.env.GITHUB_ACTIONS ? '/simdraw/' : '/';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'SimDraw',
        short_name: 'SimDraw',
        description: 'Rita och simulera enkla likströmskretsar',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        orientation: 'any',
        scope: base,
        start_url: base,
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
  },
});
