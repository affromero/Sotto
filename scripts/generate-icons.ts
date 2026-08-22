import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));

const SOURCE_MARK = join(scriptDir, '..', 'assets', 'sotto-mark.svg');
const OUTPUT_DIR = join(scriptDir, '..', 'apps', 'web', 'public');
const BRAND_DIR = join(OUTPUT_DIR, 'brand');
const DESKTOP_DIR = join(scriptDir, '..', 'apps', 'desktop', 'src');
const APP_DIR = join(scriptDir, '..', 'apps', 'web', 'src', 'app');
const IOS_ICON_DIR = join(
  scriptDir,
  '..',
  'apps',
  'ios',
  'Sources',
  'Assets.xcassets',
  'AppIcon.appiconset'
);

// Every unique pixel size referenced by AppIcon.appiconset/Contents.json.
const IOS_ICON_SIZES = [20, 29, 40, 58, 60, 80, 87, 120, 152, 167, 180, 1024];

// SottoTheme.paper. iOS app icons must be fully opaque, since an alpha channel
// is rejected at upload as ITMS-90717, so the mark is flattened onto the brand
// ground rather than shipped with transparent corners like the web icons.
const IOS_ICON_BACKGROUND = { r: 245, g: 244, b: 240 };

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

async function generateIosIcon(size: number): Promise<void> {
  const filename = `sotto-icon-${size}.png`;
  await sharp(markSvg)
    .resize(size, size)
    .flatten({ background: IOS_ICON_BACKGROUND })
    .png()
    .toFile(join(IOS_ICON_DIR, filename));
  log(`Generated ios/${filename} (${size}x${size})`);
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

  for (const size of IOS_ICON_SIZES) {
    await generateIosIcon(size);
  }

  log('All icons generated.');
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
