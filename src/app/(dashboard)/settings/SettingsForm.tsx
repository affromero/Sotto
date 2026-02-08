'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import styles from './page.module.css';

interface SettingsFormProps {
  initialName: string;
  initialBio: string;
  email: string;
  image: string | null;
  connectedProviders: string[];
}

const providerLabels: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  apple: 'Apple',
};

export function SettingsForm({
  initialName,
  initialBio,
  email,
  image,
  connectedProviders,
}: SettingsFormProps) {
  const [name, setName] = useState(initialName);
  const [bio, setBio] = useState(initialBio);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);

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
