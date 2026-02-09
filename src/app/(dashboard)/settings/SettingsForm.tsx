'use client';

import { useState } from 'react';
import { signIn, signOut } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { VoicePreferenceSelector } from '@/components/settings/VoicePreferenceSelector';
import styles from './page.module.css';

interface VoiceCloneData {
  id: string;
  name: string;
  elevenLabsVoiceId: string;
}

interface SettingsFormProps {
  initialName: string;
  initialBio: string;
  email: string;
  image: string | null;
  connectedProviders: string[];
  twitterHandle: string | null;
  twitterEnabled: boolean;
  preferredHostVoiceId: string | null;
  preferredExpertVoiceId: string | null;
  voiceClones: VoiceCloneData[];
}

const providerLabels: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  apple: 'Apple',
  twitter: 'Twitter',
};

export function SettingsForm({
  initialName,
  initialBio,
  email,
  image,
  connectedProviders,
  twitterHandle,
  twitterEnabled: initialTwitterEnabled,
  preferredHostVoiceId: initialHostVoiceId,
  preferredExpertVoiceId: initialExpertVoiceId,
  voiceClones,
}: SettingsFormProps) {
  const [name, setName] = useState(initialName);
  const [bio, setBio] = useState(initialBio);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);

  // Twitter state
  const isTwitterConnected = connectedProviders.includes('twitter');
  const [twitterEnabled, setTwitterEnabled] = useState(initialTwitterEnabled);
  const [hostVoiceId, setHostVoiceId] = useState<string | null>(initialHostVoiceId);
  const [expertVoiceId, setExpertVoiceId] = useState<string | null>(initialExpertVoiceId);
  const [twitterSaving, setTwitterSaving] = useState(false);
  const [twitterSaved, setTwitterSaved] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const response = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bio }),
      });
      if (response.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    const response = await fetch('/api/users/me', {
      method: 'DELETE',
    });
    if (response.ok) {
      signOut({ callbackUrl: '/' });
    }
  };

  const handleSaveTwitterSettings = async () => {
    setTwitterSaving(true);
    setTwitterSaved(false);
    try {
      const response = await fetch('/api/users/me/twitter', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          twitterEnabled,
          preferredHostVoiceId: hostVoiceId,
          preferredExpertVoiceId: expertVoiceId,
        }),
      });
      if (response.ok) {
        setTwitterSaved(true);
        setTimeout(() => setTwitterSaved(false), 3000);
      }
    } finally {
      setTwitterSaving(false);
    }
  };

  const handleDisconnectTwitter = async () => {
    setDisconnecting(true);
    try {
      const response = await fetch('/api/users/me/twitter', { method: 'DELETE' });
      if (response.ok) {
        window.location.reload();
      }
    } finally {
      setDisconnecting(false);
    }
  };

  const initials = (name || email || '?').charAt(0).toUpperCase();

  return (
    <div className={styles.sections}>
      {/* Profile Section */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Profile</h2>
        <form onSubmit={handleSaveProfile} className={styles.form}>
          <div className={styles.avatarSection}>
            <div className={styles.avatar}>
              {image ? (
                <img src={image} alt="Your avatar" className={styles.avatarImage} />
              ) : (
                <span className={styles.avatarFallback}>{initials}</span>
              )}
            </div>
            <div className={styles.avatarInfo}>
              <p className={styles.avatarEmail}>{email}</p>
              <p className={styles.avatarHint}>Avatar is synced from your sign-in provider</p>
            </div>
          </div>

          <Input
            label="Display Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={100}
          />

          <div className={styles.fieldGroup}>
            <label htmlFor="bio" className={styles.fieldLabel}>Bio</label>
            <textarea
              id="bio"
              className={styles.textarea}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell people about yourself..."
              rows={4}
              maxLength={500}
            />
            <span className={styles.charCount}>{bio.length}/500</span>
          </div>

          <div className={styles.formActions}>
            <Button type="submit" loading={saving} disabled={saving}>
              {saved ? 'Saved' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </section>

      {/* Notifications Section */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Notifications</h2>
        <div className={styles.toggleList}>
          <label className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleLabel}>Email Notifications</span>
              <span className={styles.toggleDescription}>Receive updates about your podcasts via email</span>
            </div>
            <input
              type="checkbox"
              className={styles.toggle}
              checked={emailNotifications}
              onChange={(e) => setEmailNotifications(e.target.checked)}
              aria-label="Toggle email notifications"
            />
          </label>
          <label className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleLabel}>Push Notifications</span>
              <span className={styles.toggleDescription}>Get notified when your podcast is ready</span>
            </div>
            <input
              type="checkbox"
              className={styles.toggle}
              checked={pushNotifications}
              onChange={(e) => setPushNotifications(e.target.checked)}
              aria-label="Toggle push notifications"
            />
          </label>
        </div>
      </section>

      {/* Connected Accounts Section */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Connected Accounts</h2>
        <div className={styles.providerList}>
          {connectedProviders.map((provider) => (
            <div key={provider} className={styles.providerRow}>
              <span className={styles.providerName}>
                {providerLabels[provider] || provider}
              </span>
              <span className={styles.providerStatus}>Connected</span>
            </div>
          ))}
          {connectedProviders.length === 0 && (
            <p className={styles.noProviders}>No connected accounts</p>
          )}
        </div>
        <div className={styles.formActions}>
          <Button variant="secondary" onClick={() => signOut({ callbackUrl: '/' })}>
            Sign Out
          </Button>
        </div>
      </section>

      {/* Twitter Integration Section */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Twitter Integration</h2>
        {!isTwitterConnected ? (
          <div>
            <p className={styles.twitterDescription}>
              Connect your Twitter account to generate podcasts by tweeting at @sottofm.
            </p>
            <div className={styles.formActions}>
              <Button onClick={() => signIn('twitter')}>
                Connect Twitter
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.form}>
            {twitterHandle && (
              <p className={styles.twitterHandle}>@{twitterHandle}</p>
            )}

            <label className={styles.toggleRow}>
              <div className={styles.toggleInfo}>
                <span className={styles.toggleLabel}>Enable Tweet-to-Podcast</span>
                <span className={styles.toggleDescription}>
                  Generate podcasts when you tweet at @sottofm
                </span>
              </div>
              <input
                type="checkbox"
                className={styles.toggle}
                checked={twitterEnabled}
                onChange={(e) => setTwitterEnabled(e.target.checked)}
                aria-label="Toggle Twitter podcast generation"
              />
            </label>

            <VoicePreferenceSelector
              label="Preferred Host Voice"
              value={hostVoiceId}
              onChange={setHostVoiceId}
              voiceClones={voiceClones}
            />

            <VoicePreferenceSelector
              label="Preferred Expert Voice"
              value={expertVoiceId}
              onChange={setExpertVoiceId}
              voiceClones={voiceClones}
            />

            <div className={styles.formActions}>
              <Button
                onClick={handleSaveTwitterSettings}
                loading={twitterSaving}
                disabled={twitterSaving}
              >
                {twitterSaved ? 'Saved' : 'Save Twitter Settings'}
              </Button>
              <Button
                variant="danger"
                onClick={handleDisconnectTwitter}
                loading={disconnecting}
                disabled={disconnecting}
              >
                Disconnect Twitter
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Danger Zone */}
      <section className={`${styles.section} ${styles.dangerSection}`}>
        <h2 className={styles.sectionTitle}>Danger Zone</h2>
        <p className={styles.dangerText}>
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>
        {!showDeleteConfirm ? (
          <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
            Delete Account
          </Button>
        ) : (
          <div className={styles.deleteConfirm}>
            <p className={styles.confirmText}>Are you sure? This will delete all your podcasts, data, and cannot be reversed.</p>
            <div className={styles.confirmActions}>
              <Button variant="danger" onClick={handleDeleteAccount}>
                Yes, Delete My Account
              </Button>
              <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
