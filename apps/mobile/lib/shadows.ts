import { Platform, ViewStyle } from 'react-native';
import { colors } from '@sotto/shared';

type ShadowPreset = Pick<ViewStyle, 'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'>;

function shadow(
  offsetY: number,
  radius: number,
  opacity: number,
  elevation: number,
  color = '#000',
): ShadowPreset {
  return Platform.select({
    ios: {
      shadowColor: color,
      shadowOffset: { width: 0, height: offsetY },
      shadowOpacity: opacity,
      shadowRadius: radius,
    },
    android: {
      elevation,
    },
    default: {
      shadowColor: color,
      shadowOffset: { width: 0, height: offsetY },
      shadowOpacity: opacity,
      shadowRadius: radius,
    },
  }) as ShadowPreset;
}

export const shadowSm = shadow(1, 2, 0.08, 1);
export const shadowMd = shadow(2, 6, 0.1, 3);
export const shadowLg = shadow(4, 12, 0.12, 6);
export const shadowXl = shadow(8, 24, 0.16, 12);

export const shadowPrimaryGlow = shadow(2, 8, 0.35, 4, colors.primary);
export const shadowAccentGlow = shadow(2, 8, 0.3, 4, colors.accent);
