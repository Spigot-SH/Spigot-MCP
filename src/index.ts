import { runServer } from './server/run.js';

void runServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Server startup failed.';
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', event: 'server_startup_failed', message })}\n`
  );
  process.exitCode = 1;
});
