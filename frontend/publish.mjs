import { readdir, mkdir, copyFile, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const built = path.join(root, 'dist/browser');
const site = path.join(root, '../site');
const assets = path.join(site, 'assets/explorer');
await mkdir(assets, { recursive: true });
for (const file of await readdir(assets)) {
  if (/^(main|styles|chunk|polyfills)-[A-Z0-9]+\.(js|css)$/.test(file)) await unlink(path.join(assets, file));
}
for (const file of await readdir(built, { withFileTypes: true })) {
  if (file.isFile() && /\.(js|css|txt)$/.test(file.name)) {
    await copyFile(path.join(built, file.name), path.join(assets, file.name));
  }
}
await copyFile(path.join(root, 'dist/3rdpartylicenses.txt'), path.join(assets, '3rdpartylicenses.txt'));
const html = (await readFile(path.join(built, 'index.html'), 'utf8'))
  .replace(/(src|href)="([^"/]+\.(?:js|css))"/g, '$1="assets/explorer/$2"');
await writeFile(path.join(site, 'index.html'), html);
console.log('Angular Explorer published to site/index.html');
