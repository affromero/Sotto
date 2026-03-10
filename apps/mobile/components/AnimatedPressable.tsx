import { PropsWithChildren } from 'react';
import { PressableProps, ViewStyle, StyleProp } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Pressable } from 'react-native';

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

interface AnimatedPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  scaleDown?: number;
}

export function AnimatedPressable({
  children,
  style,
  scaleDown = 0.97,
  onPressIn,
  onPressOut,
  ...props
}: PropsWithChildren<AnimatedPressableProps>) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressableBase
      {...props}
      style={[animatedStyle, style]}
      onPressIn={(e) => {
        scale.value = withSpring(scaleDown, { damping: 15, stiffness: 300 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 10, stiffness: 200 });
        onPressOut?.(e);
      }}
    >
      {children}
    </AnimatedPressableBase>
  );
}
