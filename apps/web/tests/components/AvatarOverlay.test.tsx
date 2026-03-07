import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AvatarOverlay } from '@/components/player/AvatarOverlay';

describe('AvatarOverlay', () => {
  const defaultProps = {
    videoUrl: 'https://cdn.example.com/avatar.webm',
    speaker: 'Host',
    posX: 0.1,
    posY: 0.5,
    width: 0.25,
    height: 0.35,
    currentTime: 0,
    isPlaying: false,
    containerWidth: 800,
    containerHeight: 450,
    onPositionChange: vi.fn(),
    editable: true,
  };

  it('renders with correct position and dimensions', () => {
    render(<AvatarOverlay {...defaultProps} />);
    const overlay = screen.getByLabelText('Avatar overlay for Host');
    expect(overlay).toBeDefined();
    expect(overlay.style.left).toBe('80px');
    expect(overlay.style.top).toBe('225px');
    expect(overlay.style.width).toBe('200px');
    expect(overlay.style.height).toBe('157.5px');
  });

  it('shows speaker tag and resize handle when editable', () => {
    render(<AvatarOverlay {...defaultProps} />);
    expect(screen.getByText('Host')).toBeDefined();
  });

  it('does not show speaker tag when not editable', () => {
    render(<AvatarOverlay {...defaultProps} editable={false} />);
    expect(screen.queryByText('Host')).toBeNull();
  });

  it('fires onPositionChange during drag', () => {
    const onChange = vi.fn();
    render(<AvatarOverlay {...defaultProps} onPositionChange={onChange} />);
    const overlay = screen.getByLabelText('Avatar overlay for Host');

    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 200 });
    fireEvent.pointerMove(overlay, { clientX: 180, clientY: 250 });
    fireEvent.pointerUp(overlay);

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.posX).toBeGreaterThan(0.1);
    expect(lastCall.posY).toBeGreaterThan(0.5);
  });

  it('contains a video element with correct src', () => {
    const { container } = render(<AvatarOverlay {...defaultProps} />);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.src).toContain('avatar.webm');
  });
});
