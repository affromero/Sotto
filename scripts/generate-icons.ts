import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
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
const IOS_COMPOSER_ASSETS_DIR = join(
  scriptDir,
  '..',
  'apps',
  'ios',
  'Sources',
  'AppIcon.icon',
  'Assets'
);

// Every unique pixel size referenced by AppIcon.appiconset/Contents.json.
const IOS_ICON_SIZES = [20, 29, 40, 58, 60, 80, 87, 120, 152, 167, 180, 1024];

// Match the Icon Composer default fill without the paper surround. Legacy
// PNGs stay opaque; Composer keeps its separate transparent foreground.
const IOS_ICON_BACKGROUND = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"
       viewBox="0 0 100 100">
    <defs>
      <linearGradient id="background" x1="0.16" y1="0.04" x2="0.84" y2="0.96">
        <stop offset="0" stop-color="#6AA0FF"/>
        <stop offset="1" stop-color="#FF8FB1"/>
      </linearGradient>
    </defs>
    <rect width="100" height="100" fill="url(#background)"/>
  </svg>
`);

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
  await sharp(IOS_ICON_BACKGROUND)
    .resize(size, size)
    .composite([{ input: await renderPng(size) }])
    .removeAlpha()
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

  mkdirSync(IOS_COMPOSER_ASSETS_DIR, { recursive: true });
  await sharp(markSvg)
    .resize(1024, 1024)
    .png()
    .toFile(join(IOS_COMPOSER_ASSETS_DIR, 'sotto-mark.png'));
  log('Generated Icon Composer foreground (1024x1024, transparent)');

  log('All icons generated.');
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
