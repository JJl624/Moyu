import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";

const server = await createServer({ server: { strictPort: false } });
await server.listen();
server.printUrls();
const env = { ...process.env, MOYU_DEV_URL: server.resolvedUrls.local[0] };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], { stdio: "inherit", env });
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill());
