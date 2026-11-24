import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const assets = path.resolve('src/assets');
const svg = await fs.readFile(path.join(assets, 'icon.svg'));
const smallSvg = await fs.readFile(path.join(assets, 'icon-small.svg'));

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
for (const size of sizes) {
  const out = path.join(assets, `icon-${size}.png`);
  const source = size <= 32 ? smallSvg : svg;
  const image = await sharp(source, { density: 300 })
    .resize(size, size, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  await fs.writeFile(out, image);
  console.log(`icon-${size}.png${size <= 32 ? ' (small)' : ''}`);
}

const icoSources = [16, 24, 32, 48, 64, 128, 256].map((size) => path.join(assets, `icon-${size}.png`));
const ico = await pngToIco(icoSources);
await fs.writeFile(path.join(assets, 'icon.ico'), ico);
console.log('icon.ico');

const logoSvg = await fs.readFile(path.join(assets, 'logo.svg'));
await sharp(logoSvg, { density: 220 }).resize(1600, 480).png().toFile(path.join(assets, 'logo.png'));
console.log('logo.png');
