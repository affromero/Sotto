import { SottoSpinner } from './SottoSpinner';

interface SpinnerProps {
  size?: 'small' | 'medium' | 'large';
  color?: 'primary' | 'accent' | 'white';
}

export function Spinner({ size = 'medium', color = 'primary' }: SpinnerProps) {
  return <SottoSpinner size={size} color={color} ariaLabel="Loading" />;
}
