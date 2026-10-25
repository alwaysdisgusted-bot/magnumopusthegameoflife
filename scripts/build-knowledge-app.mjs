import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const checks = [
  [path.join(root, 'node_modules/typescript-knowledge/bin/tsc'), ['--project', path.join(root, 'knowledge-app/tsconfig.json')]],
  [path.join(root, 'node_modules/vite/bin/vite.js'), ['build', '--config', path.join(root, 'knowledge-app/vite.config.ts')]],
];

for (const [executable, args] of checks) {
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
