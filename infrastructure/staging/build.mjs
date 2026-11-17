import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
function run(args, quiet = false) {
  return new Promise((resolve) => {
    const p = spawn('docker', args, {
      cwd: root,
      env: process.env,
      stdio: quiet ? 'ignore' : 'inherit',
    });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}
const modern = await run(['buildx', 'version'], true);
if (!modern) process.env.DOCKER_BUILDKIT = '0';
for (const [target, image] of [
  ['api', process.env.API_IMAGE ?? 'kvg-api:staging'],
  ['web', process.env.WEB_IMAGE ?? 'kvg-web:staging'],
]) {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]*$/.test(image) ||
    !(await run([
      'build',
      '-f',
      'infrastructure/staging/Dockerfile',
      '--target',
      target,
      '-t',
      image,
      '.',
    ]))
  ) {
    process.exitCode = 1;
    break;
  }
}
