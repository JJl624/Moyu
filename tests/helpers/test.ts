export * from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { recordTestProcess, recordTestProfile } from '../../scripts/test-artifacts.mjs';

// Register only profiles launched by this run. This also keeps concurrent runs
// and old failure reproductions out of successful-run cleanup.
export const _electron = {
  async launch(options?: Parameters<typeof electron.launch>[0]) {
    await recordTestProfile(options?.env);
    const app = await electron.launch(options);
    await recordTestProcess(app.process().pid);
    return app;
  },
};
