'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './AvatarOverlay.module.css';

interface AvatarOverlayProps {
  videoUrl: string;
  speaker: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  currentTime: number;
  isPlaying: boolean;
  containerWidth: number;
  containerHeight: number;
  onPositionChange: (pos: { posX: number; posY: number; width: number; height: number }) => void;
  editable: boolean;
  maskShape?: 'none' | 'rounded' | 'circle';
}

export function AvatarOverlay({
  videoUrl,
  speaker,
  posX,
  posY,
  width,
  height,
  currentTime,
  isPlaying,
  containerWidth,
  containerHeight,
  onPositionChange,
  editable,
  maskShape,
}: AvatarOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Sync video playback with audio currentTime
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.readyState) return;
    const diff = Math.abs(video.currentTime - currentTime);
    if (diff > 0.3) {
      video.currentTime = currentTime;
    }
  }, [currentTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying]);

  // Convert normalized to pixel positions
  const pxLeft = posX * containerWidth;
  const pxTop = posY * containerHeight;
  const pxWidth = width * containerWidth;
  const pxHeight = height * containerHeight;

  // Drag handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!editable) return;
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY, posX, posY };
      if ((e.target as HTMLElement).setPointerCapture) {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [editable, posX, posY],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragging) {
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        const newPosX = Math.max(0, Math.min(1 - width, dragStartRef.current.posX + dx / containerWidth));
        const newPosY = Math.max(0, Math.min(1 - height, dragStartRef.current.posY + dy / containerHeight));
        onPositionChange({ posX: newPosX, posY: newPosY, width, height });
      } else if (resizing) {
        const dx = e.clientX - resizeStartRef.current.x;
        const dy = e.clientY - resizeStartRef.current.y;
        const newWidth = Math.max(0.05, Math.min(0.8, resizeStartRef.current.width + dx / containerWidth));
        const newHeight = Math.max(0.05, Math.min(0.8, resizeStartRef.current.height + dy / containerHeight));
        onPositionChange({ posX, posY, width: newWidth, height: newHeight });
      }
    },
    [dragging, resizing, width, height, containerWidth, containerHeight, posX, posY, onPositionChange],
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
    setResizing(false);
  }, []);

  // Resize handle
  const handleResizeDown = useCallback(
    (e: React.PointerEvent) => {
      if (!editable) return;
      e.preventDefault();
      e.stopPropagation();
      setResizing(true);
      resizeStartRef.current = { x: e.clientX, y: e.clientY, width, height };
      if ((e.target as HTMLElement).setPointerCapture) {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [editable, width, height],
  );

  return (
    <div
      ref={overlayRef}
      className={`${styles.overlay} ${editable ? styles.editable : ''} ${dragging ? styles.dragging : ''} ${maskShape === 'rounded' ? `${styles.maskedOverlay} ${styles.maskRounded}` : ''} ${maskShape === 'circle' ? `${styles.maskedOverlay} ${styles.maskCircle}` : ''}`}
      style={{
        left: pxLeft,
        top: pxTop,
        width: pxWidth,
        height: pxHeight,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      aria-label={`Avatar overlay for ${speaker}`}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        className={`${styles.video} ${maskShape && maskShape !== 'none' ? styles.maskedVideo : ''}`}
        muted
        playsInline
        loop
      />
      {editable && (
        <>
          <span className={styles.speakerTag}>{speaker}</span>
          <div
            className={styles.resizeHandle}
            onPointerDown={handleResizeDown}
          />
        </>
      )}
    </div>
  );
}
