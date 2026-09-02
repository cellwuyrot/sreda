import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const pngPath = join(root, 'resources', 'icon.png');
const icoPath = join(root, 'resources', 'icon.ico');

if (!existsSync(pngPath)) {
  console.error('❌  Не найден resources/icon.png');
  process.exit(1);
}

const buf = await pngToIco(pngPath);
writeFileSync(icoPath, buf);
console.log('✅  resources/icon.ico создан');