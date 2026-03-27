import { mkdir, rm, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const sourceDir = join(projectRoot, 'wwwroot');
const distDir = join(projectRoot, 'dist');

const staticFiles = [
  'index.html',
  'admin.html',
  'styles.css',
  'app.js',
  'maitreya.html'
];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const fileName of staticFiles) {
  await copyFile(join(sourceDir, fileName), join(distDir, fileName));
}

await build({
  entryPoints: [join(projectRoot, 'src', 'admin-client.js')],
  outfile: join(distDir, 'admin.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  charset: 'utf8',
  logLevel: 'info'
});
