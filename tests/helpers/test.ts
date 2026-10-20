export * from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { recordTestProcess, recordTestProfile } from '../../scripts/test-artifacts.mjs';

// Register only profiles launched by this run. This also keeps concurrent runs
// and old failure reproductions out of successful-run cleanup.
export const _electron = {
  async launch(options?: Parameters<typeof electron.launch>[0]) {
    const mapped=process.platform==='linux'&&process.env.MOYU_TEST_XVFB==='1';
    if(mapped)options={...options,env:{...(options?.env??process.env),MOYU_TEST_OFFSCREEN:'0'}};
    await recordTestProfile(options?.env);
    const app = await electron.launch(options);
    await recordTestProcess(app.process().pid);
    // Use a mapped window on the isolated Xvfb display. Chromium's Linux
    // offscreen path does not reliably deliver native selection/iframe input.
    if(mapped){const page=await app.firstWindow();await(await app.browserWindow(page)).evaluate(win=>{win.showInactive();win.webContents.focus();win.webContents.setBackgroundThrottling(false);});}
    return app;
  },
};
