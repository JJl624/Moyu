import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'mobile-*.spec.ts',workers:1,timeout:60000,expect:{timeout:10000},
  reporter:'list',use:{baseURL:'http://127.0.0.1:5184',trace:'retain-on-failure',viewport:{width:393,height:851},isMobile:true,hasTouch:true,deviceScaleFactor:1},
  webServer:{command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5184 --strictPort',url:'http://127.0.0.1:5184/mobile.html',reuseExistingServer:!process.env.CI,timeout:60000},
});
