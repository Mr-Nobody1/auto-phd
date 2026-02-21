import { spawn } from 'node:child_process';

const bunCommand = process.platform === 'win32' ? 'bun.exe' : 'bun';

const children = [
  spawn(bunCommand, ['run', 'dev:node'], { stdio: 'inherit' }),
  spawn(bunCommand, ['run', 'dev:py'], { stdio: 'inherit' }),
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(code), 150);
}

for (const child of children) {
  child.on('exit', (code) => {
    if (shuttingDown) return;
    shutdown(code ?? 0);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
