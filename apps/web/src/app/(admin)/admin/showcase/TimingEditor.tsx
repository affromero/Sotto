'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import styles from './TimingEditor.module.css';

export interface TimingSegment {
  start: number;
  end: number;
  speed: number;
}

interface TimingEditorProps {
  scene: {
    id: string;
    order: number;
    title: string;
    recordingUrl: string | null;
    recordingStatus: string;
    voiceoverUrl: string | null;
    voiceoverStatus: string;
    timingSegments: TimingSegment[] | null;
  };
  onSave: (data: { timingSegments: TimingSegment[] | null }) => void;
}

const SPEED_PRESETS = [1, 2, 4, 8, 16];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function segmentColor(speed: number): string {
  if (speed === 0) return 'var(--color-error, #ef4444)';
  if (speed === 1) return 'var(--color-success, #22c55e)';
  if (speed <= 4) return 'var(--color-primary)';
  return '#8b5cf6'; // purple for heavy speedup
}

export function computeAdjustedDuration(segments: TimingSegment[]): number {
  return segments.reduce((total, seg) => {
    if (seg.speed === 0) return total;
    return total + (seg.end - seg.start) / seg.speed;
  }, 0);
}

export function TimingEditor({ scene, onSave }: TimingEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [segments, setSegments] = useState<TimingSegment[]>(
    () => scene.timingSegments && scene.timingSegments.length > 0 ? scene.timingSegments : [],
  );
  const [draggingHandle, setDraggingHandle] = useState<number | null>(null);
  const [voiceoverDuration, setVoiceoverDuration] = useState(0);

  const hasRecording = scene.recordingStatus === 'READY' && scene.recordingUrl;

  // Sync video time
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setCurrentTime(video.currentTime);
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [expanded]);

  // Get voiceover duration
  useEffect(() => {
    if (!scene.voiceoverUrl || scene.voiceoverStatus !== 'READY') return;
    const audio = new Audio(scene.voiceoverUrl);
    audio.addEventListener('loadedmetadata', () => setVoiceoverDuration(audio.duration));
    audio.load();
  }, [scene.voiceoverUrl, scene.voiceoverStatus]);

  const dirty = JSON.stringify(segments) !== JSON.stringify(scene.timingSegments ?? []);
  const adjustedDuration = segments.length > 0 ? computeAdjustedDuration(segments) : recordingDuration;

  // Split at current playhead position
  const splitAtPlayhead = useCallback(() => {
    const t = currentTime;
    if (t <= 0 || t >= recordingDuration) return;

    setSegments((prev) => {
      const idx = prev.findIndex((s) => t > s.start && t < s.end);
      if (idx === -1) return prev;
      const seg = prev[idx];
      const before: TimingSegment = { start: seg.start, end: t, speed: seg.speed };
      const after: TimingSegment = { start: t, end: seg.end, speed: seg.speed };
      return [...prev.slice(0, idx), before, after, ...prev.slice(idx + 1)];
    });
  }, [currentTime, recordingDuration]);

  // Merge segment with next
  const mergeSegment = useCallback((index: number) => {
    setSegments((prev) => {
      if (index >= prev.length - 1) return prev;
      const merged: TimingSegment = {
        start: prev[index].start,
        end: prev[index + 1].end,
        speed: prev[index].speed,
      };
      return [...prev.slice(0, index), merged, ...prev.slice(index + 2)];
    });
  }, []);

  // Update speed for a segment
  const setSpeed = useCallback((index: number, speed: number) => {
    setSegments((prev) =>
      prev.map((s, i) => (i === index ? { ...s, speed } : s))
    );
  }, []);

  // Timeline click → seek video
  const onTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !videoRef.current || recordingDuration <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    videoRef.current.currentTime = ratio * recordingDuration;
  }, [recordingDuration]);

  // Handle drag for split-point adjustment
  const onHandlePointerDown = useCallback((index: number, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingHandle(index);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingHandle === null || !timelineRef.current || recordingDuration <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = ratio * recordingDuration;

    setSegments((prev) => {
      const i = draggingHandle;
      if (i < 0 || i >= prev.length - 1) return prev;
      const minT = prev[i].start + 0.1;
      const maxT = prev[i + 1].end - 0.1;
      const clamped = Math.max(minT, Math.min(maxT, newTime));
      const updated = [...prev];
      updated[i] = { ...updated[i], end: clamped };
      updated[i + 1] = { ...updated[i + 1], start: clamped };
      return updated;
    });
  }, [draggingHandle, recordingDuration]);

  const onHandlePointerUp = useCallback(() => {
    setDraggingHandle(null);
  }, []);

  if (!hasRecording) {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.order}>{scene.order + 1}</span>
          <span className={styles.title}>{scene.title}</span>
          <span className={styles.noRecording}>No recording</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <button className={styles.header} onClick={() => setExpanded(!expanded)}>
        <span className={styles.order}>{scene.order + 1}</span>
        <span className={styles.title}>{scene.title}</span>
        <span className={styles.durationBadge}>
          {formatTime(adjustedDuration)}
          {recordingDuration > 0 && adjustedDuration !== recordingDuration && (
            <span className={styles.originalDuration}> / {formatTime(recordingDuration)} orig</span>
          )}
        </span>
        <span className={styles.expandIcon}>{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className={styles.body}>
          {/* Video preview */}
          <video
            ref={videoRef}
            className={styles.video}
            src={scene.recordingUrl!}
            controls
            preload="metadata"
            onLoadedMetadata={(e) => {
              const dur = (e.target as HTMLVideoElement).duration;
              setRecordingDuration(dur);
              if (segments.length === 0) {
                setSegments([{ start: 0, end: dur, speed: 1 }]);
              }
            }}
          />

          {/* Split button */}
          <div className={styles.splitRow}>
            <button className={styles.splitBtn} onClick={splitAtPlayhead}>
              Split at {formatTime(currentTime)}
            </button>
          </div>

          {/* Timeline bar */}
          <div
            ref={timelineRef}
            className={styles.timeline}
            onClick={onTimelineClick}
            onPointerMove={draggingHandle !== null ? onHandlePointerMove : undefined}
            onPointerUp={draggingHandle !== null ? onHandlePointerUp : undefined}
          >
            {segments.map((seg, i) => {
              const widthPct = recordingDuration > 0
                ? ((seg.end - seg.start) / recordingDuration) * 100
                : 100 / segments.length;
              return (
                <div key={i} className={styles.timelineGroup} style={{ width: `${widthPct}%` }}>
                  <div
                    className={styles.timelineSegment}
                    style={{ background: segmentColor(seg.speed) }}
                    data-skip={seg.speed === 0 ? 'true' : undefined}
                  >
                    <span className={styles.segmentLabel}>
                      {seg.speed === 0 ? 'Skip' : `${seg.speed}x`}
                    </span>
                  </div>
                  {i < segments.length - 1 && (
                    <div
                      className={styles.handle}
                      onPointerDown={(e) => onHandlePointerDown(i, e)}
                    />
                  )}
                </div>
              );
            })}
            {/* Playhead */}
            {recordingDuration > 0 && (
              <div
                className={styles.playhead}
                style={{ left: `${(currentTime / recordingDuration) * 100}%` }}
              />
            )}
          </div>

          {/* Segment rows */}
          <div className={styles.segmentList}>
            {segments.map((seg, i) => (
              <div key={i} className={styles.segmentRow}>
                <span className={styles.segmentTime}>
                  {formatTime(seg.start)} – {formatTime(seg.end)}
                </span>
                <div className={styles.speedControls}>
                  {SPEED_PRESETS.map((sp) => (
                    <button
                      key={sp}
                      className={styles.speedBtn}
                      data-active={seg.speed === sp ? 'true' : undefined}
                      onClick={() => setSpeed(i, sp)}
                    >
                      {sp}x
                    </button>
                  ))}
                  <button
                    className={styles.speedBtn}
                    data-active={seg.speed === 0 ? 'true' : undefined}
                    data-skip="true"
                    onClick={() => setSpeed(i, 0)}
                  >
                    Skip
                  </button>
                </div>
                <span className={styles.segmentResult}>
                  {seg.speed === 0 ? 'cut' : formatTime((seg.end - seg.start) / seg.speed)}
                </span>
                {segments.length > 1 && i < segments.length - 1 && (
                  <button className={styles.mergeBtn} onClick={() => mergeSegment(i)} title="Merge with next">
                    ⊕
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Duration summary */}
          <div className={styles.summary}>
            <span>Recording: {formatTime(recordingDuration)}</span>
            <span>Adjusted: <strong>{formatTime(adjustedDuration)}</strong></span>
            {voiceoverDuration > 0 && (
              <span
                className={styles.voiceoverCompare}
                data-warn={Math.abs(adjustedDuration - voiceoverDuration) / voiceoverDuration > 0.2 ? 'true' : undefined}
              >
                Voiceover: {formatTime(voiceoverDuration)}
              </span>
            )}
          </div>

          {/* Save */}
          {dirty && (
            <button
              className={styles.saveBtn}
              onClick={() => onSave({ timingSegments: segments })}
            >
              Save Timing
            </button>
          )}
        </div>
      )}
    </div>
  );
}
