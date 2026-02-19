import sharp from 'sharp';
import { writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

const OUTPUT_DIR = join(__dirname, '..', 'apps', 'web', 'public');

function createSvg(size: number): Buffer {
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#D97706"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
    font-family="Georgia,serif" font-weight="bold" font-size="${size * 0.6}"
    fill="#FEFCF8">S</text>
</svg>`;
  return Buffer.from(svg);
}

async function generateIcon(size: number, filename: string): Promise<void> {
  const svg = createSvg(size);
  await sharp(svg).png().toFile(join(OUTPUT_DIR, filename));
  console.log(`Generated ${filename} (${size}x${size})`);
}

async function main() {
  await generateIcon(48, 'favicon.ico');
  await generateIcon(192, 'icon-192.png');
  await generateIcon(512, 'icon-512.png');
  await generateIcon(180, 'apple-touch-icon.png');
  console.log('All icons generated.');
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
