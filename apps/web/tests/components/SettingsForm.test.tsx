import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsForm } from '@/app/(dashboard)/settings/SettingsForm';

const mockSignIn = vi.fn();
const mockSignOut = vi.fn();

vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { fill, ...rest } = props;
    return <img {...rest} />;
  },
}));

const defaultProps = {
  initialName: 'Test User',
  initialBio: 'A bio',
  initialHandle: 'testuser',
  email: 'test@example.com',
  image: null,
  role: 'USER' as const,
  connectedProviders: [],
  twitterHandle: null,
  twitterEnabled: false,
  preferredHostVoiceId: null,
  preferredExpertVoiceId: null,
  voiceClones: [],
  interestCategories: [],
  selectedInterestTagIds: [],
  configuredTtsProviders: [],
  configuredAiProviders: [],
  isTwitterProviderAvailable: false,
  quizAnswerCount: 0,
};

describe('SettingsForm', () => {
  describe('Twitter Integration visibility', () => {
    it('hides Twitter Integration section when provider is unavailable', () => {
      render(<SettingsForm {...defaultProps} isTwitterProviderAvailable={false} />);

      expect(screen.queryByText('Twitter Integration')).not.toBeInTheDocument();
      expect(screen.queryByText('Connect Twitter')).not.toBeInTheDocument();
    });

    it('shows Twitter Integration section when provider is available', () => {
      render(<SettingsForm {...defaultProps} isTwitterProviderAvailable={true} />);

      expect(screen.getByText('Twitter Integration')).toBeInTheDocument();
      expect(screen.getByText('Connect Twitter')).toBeInTheDocument();
    });

    it('shows connected state when Twitter is connected and provider is available', () => {
      render(
        <SettingsForm
          {...defaultProps}
          isTwitterProviderAvailable={true}
          connectedProviders={['twitter']}
          twitterHandle="sottofm"
        />
      );

      expect(screen.getByText('Twitter Integration')).toBeInTheDocument();
      expect(screen.queryByText('Connect Twitter')).not.toBeInTheDocument();
      expect(screen.getByText('@sottofm')).toBeInTheDocument();
      expect(screen.getByText('Save Twitter Settings')).toBeInTheDocument();
    });
  });

  describe('Twitter Connect callbackUrl', () => {
    it('calls signIn with twitter provider and callbackUrl /settings', async () => {
      const user = userEvent.setup();
      render(<SettingsForm {...defaultProps} isTwitterProviderAvailable={true} />);

      await user.click(screen.getByText('Connect Twitter'));

      expect(mockSignIn).toHaveBeenCalledWith('twitter', { callbackUrl: '/settings' });
    });
  });
});
