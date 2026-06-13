import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsForm } from '@/app/(dashboard)/settings/SettingsForm';

const mockSignOut = vi.fn();

vi.mock('next-auth/react', () => ({
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
  initialHandle: 'testuser',
  email: 'test@example.com',
  image: null,
  role: 'USER' as const,
  connectedProviders: [],
  preferredLanguage: null,
  interestCategories: [],
  selectedInterestTagIds: [],
  configuredTtsProviders: [],
  configuredAiProviders: [],
  aiProviderMeta: [],
  ttsProviderMeta: [],
  initialPreferredAiModel: null,
  referredUsers: [],
  initialEmailNotifications: true,
  initialPushNotifications: true,
  briefings: [],
  hasByokKeys: false,
  initialQuizEnabled: false,
  appBaseUrl: 'https://selfhost.example.com',
};

describe('SettingsForm', () => {
  describe('Connected Accounts', () => {
    it('shows connected OAuth accounts without bot controls', () => {
      render(<SettingsForm {...defaultProps} connectedProviders={['twitter']} />);

      expect(screen.getByText('Twitter')).toBeInTheDocument();
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.queryByText('Connect Twitter')).not.toBeInTheDocument();
      expect(screen.queryByText('Twitter Integration')).not.toBeInTheDocument();
    });
  });
});
