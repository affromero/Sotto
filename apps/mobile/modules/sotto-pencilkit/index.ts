/**
 * modules/sotto-pencilkit/index.ts
 *
 * Safe, feature-detected JS interface to the optional native SottoPencilKit module.
 * The Swift implementation lives in the native layer and is only present in a custom
 * dev build — this module degrades gracefully in Expo Go by returning null.
 */

import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { requireOptionalNativeModule, requireNativeViewManager } from 'expo-modules-core';

// ---------------------------------------------------------------------------
// Native module detection
// ---------------------------------------------------------------------------

interface SottoPencilKitNativeModule {
  // The native module exists; its exact method surface is defined in Swift.
  // We only need to detect its presence here — the view handles the canvas API.
}

const native = requireOptionalNativeModule<SottoPencilKitNativeModule>('SottoPencilKit');

/** True when the SottoPencilKit native module is linked (custom dev build). */
export const isPencilKitAvailable: boolean = native != null;

// ---------------------------------------------------------------------------
// Native view (lazily resolved only when available)
// ---------------------------------------------------------------------------

interface PencilKitNativeProps {
  initialStrokes?: string;
  onChange?: (event: { nativeEvent: { strokes: string } }) => void;
  style?: StyleProp<ViewStyle>;
}

// We only call requireNativeViewManager when the module is present; otherwise
// we never reference the (non-existent) view manager and avoid a throw.
let NativeCanvas: React.ComponentType<PencilKitNativeProps> | null = null;
if (isPencilKitAvailable) {
  NativeCanvas = requireNativeViewManager<PencilKitNativeProps>('SottoPencilKit');
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export interface PencilKitCanvasProps {
  initialStrokes?: string;
  onChange?: (base64: string) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Renders the native PencilKit canvas when available, or returns null in
 * environments where the native module is not linked (e.g. Expo Go).
 * Callers should hide the ink overlay when `isPencilKitAvailable` is false.
 */
export function PencilKitCanvas(props: PencilKitCanvasProps): React.JSX.Element | null {
  if (!isPencilKitAvailable || NativeCanvas === null) {
    return null;
  }

  const { initialStrokes, onChange, style } = props;

  const handleChange = onChange
    ? (event: { nativeEvent: { strokes: string } }) => {
        onChange(event.nativeEvent.strokes);
      }
    : undefined;

  return React.createElement(NativeCanvas, {
    initialStrokes,
    onChange: handleChange,
    style,
  });
}
