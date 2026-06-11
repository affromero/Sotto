'use client';

import type { CSSProperties } from 'react';
import { useState } from 'react';
import styles from './AvatarTile.module.css';

interface AvatarTileProps {
  /** Animal avatar path, uploaded URL, or null. May 404 until generated. */
  image: string | null;
  /** Fallback glyph for animal avatars; shown when the image is missing or 404s. */
  emoji: string | null;
  /** Used for the alt text and the initial fallback when no emoji exists. */
  name: string | null;
  /** Square edge length in px. Defaults to a comfortable picker tile. */
  size?: number;
}

/**
 * A square household avatar for the profile picker. Renders the image when one is
 * set, falling back on load error to the emoji centered on a calm aula gradient
 * tile. With no image it shows the emoji; with neither image nor emoji it shows
 * the person initial. A plain img (not next/image) is intentional: uploaded URLs
 * can live on hosts outside next.config remotePatterns, and the onError fallback
 * to emoji is the whole point. The gradient comes from a single CSS class, so no
 * per-tile inline styles are needed.
 */
export function AvatarTile({ image, emoji, name, size = 104 }: AvatarTileProps) {
  const [failed, setFailed] = useState(false);

  // Reset the error state during render when the image source changes, so a new
  // profile gets a fresh chance to load. This is React's documented "store the
  // previous prop in state" pattern, which avoids both a setState-in-effect
  // cascade and reading a ref during render.
  const [lastImage, setLastImage] = useState(image);
  if (lastImage !== image) {
    setLastImage(image);
    setFailed(false);
  }

  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  const fallbackGlyph = emoji ?? initial;
  const showImage = Boolean(image) && !failed;

  // The only escape hatch the design rules allow: a CSS custom property carries
  // the dynamic edge length, and the stylesheet (not the markup) sizes the tile.
  const sizeVar = { '--tile-size': `${size}px` } as CSSProperties;

  return (
    <span className={styles.tile} style={sizeVar} aria-hidden="true">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- onError fallback + arbitrary uploaded hosts
        <img
          src={image as string}
          alt=""
          className={styles.image}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles.glyph}>{fallbackGlyph}</span>
      )}
    </span>
  );
}
