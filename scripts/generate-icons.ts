import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SOURCE_MARK = join(__dirname, '..', 'assets', 'sotto-mark.svg');
const OUTPUT_DIR = join(__dirname, '..', 'apps', 'web', 'public');
const BRAND_DIR = join(OUTPUT_DIR, 'brand');
const DESKTOP_DIR = join(__dirname, '..', 'apps', 'desktop', 'src');
const APP_DIR = join(__dirname, '..', 'apps', 'web', 'src', 'app');

interface IcoImage {
  size: number;
  data: Buffer;
}

const markSvg = readFileSync(SOURCE_MARK);

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function createIco(images: IcoImage[]): Buffer {
  const headerSize = 6;
  const entrySize = 16;
  const directorySize = headerSize + images.length * entrySize;
  const header = Buffer.alloc(directorySize);
  let offset = directorySize;

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  images.forEach(({ size, data }, index) => {
    const entryOffset = headerSize + index * entrySize;
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(data.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += data.length;
  });

  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

async function renderPng(size: number): Promise<Buffer> {
  return sharp(markSvg).resize(size, size).png().toBuffer();
}

async function generatePngIcon(size: number, filename: string): Promise<void> {
  await sharp(markSvg).resize(size, size).png().toFile(join(OUTPUT_DIR, filename));
  log(`Generated ${filename} (${size}x${size})`);
}

async function main() {
  writeFileSync(join(BRAND_DIR, 'sotto-mark.svg'), markSvg);
  writeFileSync(join(APP_DIR, 'icon.svg'), markSvg);
  writeFileSync(join(DESKTOP_DIR, 'sotto-mark.svg'), markSvg);
  log('Synced Sotto mark SVGs.');

  await generatePngIcon(192, 'icon-192.png');
  await generatePngIcon(512, 'icon-512.png');
  await generatePngIcon(180, 'apple-touch-icon.png');

  const favicon = createIco([
    { size: 16, data: await renderPng(16) },
    { size: 32, data: await renderPng(32) },
    { size: 64, data: await renderPng(64) },
  ]);
  writeFileSync(join(OUTPUT_DIR, 'favicon.ico'), favicon);
  log('Generated favicon.ico (16x16, 32x32, 64x64)');

  log('All icons generated.');
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
