import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    base: '/budget-app/',
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
            manifest: {
                name: 'Ledger Budget App',
                short_name: 'Ledger',
                description: 'Personal Ledger & Strategy Budget App',
                theme_color: '#EFEBE2',
                background_color: '#EFEBE2',
                display: 'standalone',
                icons: [
                    {
                        src: 'https://cdn-icons-png.flaticon.com/512/2845/2845899.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: 'https://cdn-icons-png.flaticon.com/512/2845/2845899.png',
                        sizes: '512x512',
                        type: 'image/png'
                    }
                ]
            }
        })
    ]
});