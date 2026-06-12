'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { InterestGrid } from '@/components/discovery/InterestGrid';
import type { CustomTag } from '@/components/discovery/InterestGrid';
import type { TasteQuestion, TasteAnswer } from '@sotto/shared';
import { LANGUAGE_DISPLAY } from '@sotto/shared';
import { TasteQuiz } from '@/components/discovery/TasteQuiz';
import type { AiProviderClientMeta } from '@/lib/providers/ai-registry';
import type { TtsProviderClientMeta } from '@/lib/providers/tts-registry';
import { TtsProviderCards } from '@/components/settings/TtsProviderCards';
import { AiProviderCards } from '@/components/settings/AiProviderCards';
import { ThemeSelector } from '@/components/settings/ThemeSelector';
import { usePushSubscription } from '@/lib/hooks/usePushSubscription';
import styles from './page.module.css';

interface SubTag {
  id: string;
  name: string;
  slug: string;
}

interface CategoryTag {
  id: string;
  name: string;
  slug: string;
  children: SubTag[];
}

interface SettingsFormProps {
  initialName: string;
  initialHandle: string;
  email: string;
  image: string | null;
  role: 'USER' | 'ADMIN' | 'SYSTEM';
  connectedProviders: string[];
  preferredLanguage: string | null;
  interestCategories: CategoryTag[];
  selectedInterestTagIds: string[];
  configuredTtsProviders: Array<{ provider: string; isValid: boolean }>;
  configuredAiProviders: Array<{ provider: string; isValid: boolean }>;
  aiProviderMeta: AiProviderClientMeta[];
  ttsProviderMeta: TtsProviderClientMeta[];
  initialPreferredAiModel: string | null;
  initialEmailNotifications: boolean;
  initialPushNotifications: boolean;
  quizAnswerCount: number;
  referredUsers: Array<{
    name: string | null;
    handle: string | null;
    image: string | null;
    joinedAt: string;
    verified: boolean;
  }>;
  appBaseUrl: string;
}

const providerLabels: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  apple: 'Apple',
  twitter: 'Twitter',
};

export function SettingsForm({
  initialName,
  initialHandle,
  email,
  image,
  role,
  connectedProviders,
  preferredLanguage: initialPreferredLanguage,
  interestCategories,
  selectedInterestTagIds,
  configuredTtsProviders,
  configuredAiProviders,
  aiProviderMeta,
  ttsProviderMeta,
  initialPreferredAiModel,
  initialEmailNotifications,
  initialPushNotifications,
  quizAnswerCount,
  referredUsers,
  appBaseUrl,
}: SettingsFormProps) {
  const [name, setName] = useState(initialName);
  const [handle, setHandle] = useState(initialHandle);
  const [handleStatus, setHandleStatus] = useState<{
    checking: boolean;
    available?: boolean;
    reason?: string;
  }>({ checking: false });
  const handleCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const checkHandle = useCallback(
    (value: string) => {
      if (handleCheckTimer.current) clearTimeout(handleCheckTimer.current);
      if (!value || value === initialHandle) {
        setHandleStatus({ checking: false });
        return;
      }
      setHandleStatus({ checking: true });
      handleCheckTimer.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/v1/handles/check?handle=${encodeURIComponent(value)}`);
          if (res.ok) {
            const data = await res.json();
            setHandleStatus({ checking: false, available: data.available, reason: data.reason });
          } else {
            setHandleStatus({ checking: false });
          }
        } catch {
          setHandleStatus({ checking: false });
        }
      }, 400);
    },
    [initialHandle]
  );

  useEffect(() => {
    return () => {
      if (handleCheckTimer.current) clearTimeout(handleCheckTimer.current);
    };
  }, []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(initialEmailNotifications);
  const [pushNotifications, setPushNotifications] = useState(initialPushNotifications);
  const {
    pushState,
    subscribe: pushSubscribe,
    unsubscribe: pushUnsubscribe,
  } = usePushSubscription();

  const [avatarUrl, setAvatarUrl] = useState(image);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Language preference state
  const [preferredLanguage, setPreferredLanguage] = useState<string | null>(
    initialPreferredLanguage
  );
  const [languageSaving, setLanguageSaving] = useState(false);
  const [languageSaved, setLanguageSaved] = useState(false);

  // AI model preference state
  const [preferredAiModel, setPreferredAiModel] = useState(initialPreferredAiModel ?? '');
  const [aiPrefSaving, setAiPrefSaving] = useState(false);
  const [aiPrefSaved, setAiPrefSaved] = useState(false);
  const [aiModelOptions, setAiModelOptions] = useState<
    Array<{ id: string; displayName: string; tier: string; group?: string }>
  >([]);

  useEffect(() => {
    fetch('/api/v1/ai-models')
      .then((r) => (r.ok ? r.json() : null))
      .then((aiData) => {
        if (aiData?.models) setAiModelOptions(aiData.models);
      })
      .catch(() => {});
  }, []);

  // Taste quiz state
  const [quizCount, setQuizCount] = useState(quizAnswerCount);
  const [quizActive, setQuizActive] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<TasteQuestion[]>([]);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizResetting, setQuizResetting] = useState(false);

  // Interests state
  const [interestIds, setInterestIds] = useState<string[]>(selectedInterestTagIds);
  const [customTags, setCustomTags] = useState<CustomTag[]>([]);
  const [interestsSaving, setInterestsSaving] = useState(false);
  const [interestsSaved, setInterestsSaved] = useState(false);
  const [interestsResetting, setInterestsResetting] = useState(false);


  const handleInterestsChange = (tagIds: string[], custom: CustomTag[]) => {
    setInterestIds(tagIds);
    setCustomTags(custom);
  };

  const handleSaveInterests = async () => {
    setInterestsSaving(true);
    setInterestsSaved(false);
    try {
      const response = await fetch('/api/v1/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interests: interestIds, customTags }),
      });
      if (response.ok) {
        setInterestsSaved(true);
        setCustomTags([]);
        setTimeout(() => setInterestsSaved(false), 3000);
      }
    } finally {
      setInterestsSaving(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const payload: Record<string, string> = { name };
      if (handle && handle !== initialHandle) {
        payload.handle = handle;
      }
      const response = await fetch('/api/v1/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
    const response = await fetch('/api/v1/users/me', {
      method: 'DELETE',
    });
    if (response.ok) {
      signOut({ callbackUrl: '/' });
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      alert('File too large. Maximum size is 2MB.');
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      alert('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);

      const response = await fetch('/api/v1/users/me/avatar', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setAvatarUrl(data.url);
      } else {
        const errorData = await response.json();
        alert(errorData.error || 'Failed to upload avatar');
      }
    } catch {
      alert('Failed to upload avatar');
    } finally {
      setUploading(false);
    }
  };

  const initials = (name || email || 'U').charAt(0).toUpperCase();

  return (
    <div className={styles.sections}>
      {/* Appearance Section */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Appearance</h2>
        <p className={styles.sectionDesc}>Choose your preferred theme</p>
        <ThemeSelector />
      </section>

      {/* Household Section — owner only */}
      {role === 'ADMIN' && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Household</h2>
          <p className={styles.sectionDesc}>
            Invite your family to this instance. Each person learns on a private account of their
            own.
          </p>
          <Link href="/settings/household" className={styles.householdLink}>
            <span className={styles.householdLinkText}>Manage household</span>
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </section>
      )}

      {/* Password — local sign-in only; the page redirects OAuth accounts away */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Password</h2>
        <p className={styles.sectionDesc}>
          Change the password you use to sign in to this instance.
        </p>
        <Link href="/settings/password" className={styles.householdLink}>
          <span className={styles.householdLinkText}>Change password</span>
          <span aria-hidden="true">&rarr;</span>
        </Link>
      </section>

      {/* Connect a device — available to every learner */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Devices</h2>
        <p className={styles.sectionDesc}>
          Link the app on your phone or tablet by scanning a one-time code — no password to type.
        </p>
        <Link href="/settings/devices" className={styles.householdLink}>
          <span className={styles.householdLinkText}>Connect a device</span>
          <span aria-hidden="true">&rarr;</span>
        </Link>
      </section>

      {/* Profile Section */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Profile</h2>
        <form onSubmit={handleSaveProfile} className={styles.form}>
          <div className={styles.avatarSection}>
            <div className={styles.avatar}>
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt="Your avatar"
                  width={80}
                  height={80}
                  className={styles.avatarImage}
                />
              ) : (
                <span className={styles.avatarFallback}>{initials}</span>
              )}
            </div>
            <div className={styles.avatarInfo}>
              <p className={styles.avatarEmail}>
                {email}
                {role !== 'USER' && (
                  <Badge
                    variant={role === 'ADMIN' ? 'admin' : role === 'SYSTEM' ? 'system' : 'creator'}
                  >
                    {role}
                  </Badge>
                )}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleAvatarChange}
                style={{ display: 'none' }}
                aria-label="Upload avatar"
              />
              <button
                type="button"
                onClick={handleAvatarClick}
                disabled={uploading}
                className={`${styles.avatarUploadBtn} ${uploading ? styles.avatarUploading : ''}`}
              >
                {uploading ? 'Uploading...' : 'Change Avatar'}
              </button>
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
            <label htmlFor="handle" className={styles.fieldLabel}>
              Handle
            </label>
            <div className={styles.handleInputWrap}>
              <span className={styles.handlePrefix}>@</span>
              <input
                id="handle"
                type="text"
                className={styles.handleInput}
                value={handle}
                onChange={(e) => {
                  const val = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
                  setHandle(val);
                  checkHandle(val);
                }}
                placeholder="your_handle"
                maxLength={30}
                autoComplete="off"
              />
            </div>
            {handleStatus.checking && <span className={styles.handleChecking}>Checking...</span>}
            {!handleStatus.checking &&
              handleStatus.available === true &&
              handle !== initialHandle && <span className={styles.handleAvailable}>Available</span>}
            {!handleStatus.checking && handleStatus.available === false && (
              <span className={styles.handleTaken}>{handleStatus.reason || 'Not available'}</span>
            )}
          </div>

          <div className={styles.formActions}>
            <Button type="submit" loading={saving} disabled={saving}>
              {saved ? 'Saved' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </section>

      {/* Language Preference Section */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Language</h2>
        <p className={styles.sectionDesc}>
          Choose your preferred language for Q&amp;A interactions. If not set, responses will match
          the lesson&apos;s language.
        </p>
        <div className={styles.form}>
          <div className={styles.fieldGroup}>
            <label htmlFor="preferredLanguage" className={styles.fieldLabel}>
              Preferred Language
            </label>
            <select
              id="preferredLanguage"
              className={styles.handleInput}
              value={preferredLanguage ?? ''}
              onChange={(e) => setPreferredLanguage(e.target.value || null)}
              aria-label="Preferred interaction language"
            >
              <option value="">Not set (use lesson language)</option>
              {Object.entries(LANGUAGE_DISPLAY).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.formActions}>
            <Button
              onClick={async () => {
                setLanguageSaving(true);
                setLanguageSaved(false);
                try {
                  const response = await fetch('/api/v1/users/me', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ preferredLanguage }),
                  });
                  if (response.ok) {
                    setLanguageSaved(true);
                    setTimeout(() => setLanguageSaved(false), 3000);
                  }
                } finally {
                  setLanguageSaving(false);
                }
              }}
              loading={languageSaving}
              disabled={languageSaving}
            >
              {languageSaved ? 'Saved' : 'Save Language'}
            </Button>
          </div>
        </div>
      </section>

      {/* Taste Quiz Section */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Taste Quiz</h2>
        <p className={styles.sectionDesc}>
          Answer quick yes/no questions to improve your recommendations.
          {quizCount > 0 &&
            ` You\u2019ve answered ${quizCount} question${quizCount !== 1 ? 's' : ''}.`}
        </p>

        {quizActive ? (
          <TasteQuiz
            initialQuestions={quizQuestions}
            onComplete={async (answers: TasteAnswer[]) => {
              if (answers.length > 0) {
                await fetch('/api/v1/taste-quiz', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ answers }),
                });
                setQuizCount((prev) => prev + answers.filter((a) => a.response !== 'skip').length);
              }
              setQuizActive(false);
            }}
            onRequestMore={async () => {
              const res = await fetch('/api/v1/taste-quiz?count=10');
              if (!res.ok) return [];
              const data = await res.json();
              return data.questions;
            }}
            onSkipAll={() => setQuizActive(false)}
          />
        ) : (
          <div className={styles.formActions}>
            <Button
              onClick={async () => {
                setQuizLoading(true);
                try {
                  const res = await fetch('/api/v1/taste-quiz?count=10');
                  if (res.ok) {
                    const data = await res.json();
                    setQuizQuestions(data.questions);
                    setQuizActive(true);
                  }
                } finally {
                  setQuizLoading(false);
                }
              }}
              loading={quizLoading}
              disabled={quizLoading}
            >
              {quizCount > 0 ? 'Take More Questions' : 'Take the Quiz'}
            </Button>
            {quizCount > 0 && (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (
                    !confirm('Reset all quiz answers? This will remove quiz-based interest data.')
                  )
                    return;
                  setQuizResetting(true);
                  try {
                    const res = await fetch('/api/v1/taste-quiz', { method: 'DELETE' });
                    if (res.ok) {
                      setQuizCount(0);
                    }
                  } finally {
                    setQuizResetting(false);
                  }
                }}
                loading={quizResetting}
                disabled={quizResetting}
              >
                Reset Quiz Answers
              </Button>
            )}
          </div>
        )}
      </section>

      {/* Interests Section */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Interests</h2>
        <p className={styles.interestsDescription}>
          Select topics you&apos;re curious about. This helps us recommend better lessons for you.
        </p>
        <InterestGrid
          categories={interestCategories}
          selectedTagIds={interestIds}
          customTags={customTags}
          onChange={handleInterestsChange}
        />
        <div className={styles.formActions}>
          <Button
            onClick={handleSaveInterests}
            loading={interestsSaving}
            disabled={interestsSaving}
          >
            {interestsSaved ? 'Saved' : 'Save Interests'}
          </Button>
          {interestIds.length > 0 && (
            <Button
              variant="ghost"
              onClick={async () => {
                if (
                  !confirm(
                    'Clear all grid selections? This only removes manually picked interests — quiz answers are kept.'
                  )
                )
                  return;
                setInterestsResetting(true);
                try {
                  const res = await fetch('/api/v1/users/me', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ interests: [], customTags: [] }),
                  });
                  if (res.ok) {
                    setInterestIds([]);
                    setCustomTags([]);
                  }
                } finally {
                  setInterestsResetting(false);
                }
              }}
              loading={interestsResetting}
              disabled={interestsResetting}
            >
              Clear Grid Selections
            </Button>
          )}
        </div>
      </section>

      {/* Notifications Section */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Notifications</h2>
        <div className={styles.toggleList}>
          <label className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleLabel}>Email Notifications</span>
              <span className={styles.toggleDescription}>
                Receive updates about your lessons via email
              </span>
            </div>
            <input
              type="checkbox"
              className={styles.toggle}
              checked={emailNotifications}
              onChange={async (e) => {
                const checked = e.target.checked;
                setEmailNotifications(checked);
                await fetch('/api/v1/users/me', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ emailNotifications: checked }),
                });
              }}
              aria-label="Toggle email notifications"
            />
          </label>
          <label className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.toggleLabel}>Push Notifications</span>
              <span className={styles.toggleDescription}>
                {pushState === 'denied'
                  ? 'Push notifications are blocked in your browser settings'
                  : pushState === 'unsupported'
                    ? 'Push notifications are not supported in this browser'
                    : 'Get notified when your lesson is ready'}
              </span>
            </div>
            <input
              type="checkbox"
              className={styles.toggle}
              checked={pushNotifications}
              disabled={pushState === 'denied' || pushState === 'unsupported'}
              onChange={async (e) => {
                const checked = e.target.checked;
                setPushNotifications(checked);
                await fetch('/api/v1/users/me', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ pushNotifications: checked }),
                });
                if (checked) {
                  await pushSubscribe();
                } else {
                  await pushUnsubscribe();
                }
              }}
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
              <span className={styles.providerName}>{providerLabels[provider] || provider}</span>
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

      {/* AI Preferences Section */}
      {aiModelOptions.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>AI Preferences</h2>
          <p className={styles.sectionDesc}>
            Choose your default AI model for new lessons. You can override this per-lesson in the
            creation flow.
          </p>
          <div className={styles.form}>
            <div className={styles.fieldGroup}>
              <label htmlFor="preferredAiModel" className={styles.fieldLabel}>
                Default AI Model
              </label>
              <select
                id="preferredAiModel"
                className={styles.modelSelect}
                value={preferredAiModel}
                onChange={(e) => setPreferredAiModel(e.target.value)}
                aria-label="Preferred AI model for lesson generation"
              >
                <option value="">System default (Auto)</option>
                {aiModelOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.group ? ` (${m.group})` : ''} &mdash; {m.tier}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formActions}>
              <Button
                onClick={async () => {
                  setAiPrefSaving(true);
                  setAiPrefSaved(false);
                  try {
                    const response = await fetch('/api/v1/users/me', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ preferredAiModel: preferredAiModel || null }),
                    });
                    if (response.ok) {
                      setAiPrefSaved(true);
                      setTimeout(() => setAiPrefSaved(false), 3000);
                    }
                  } finally {
                    setAiPrefSaving(false);
                  }
                }}
                loading={aiPrefSaving}
                disabled={aiPrefSaving}
              >
                {aiPrefSaved ? 'Saved' : 'Save AI Preference'}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* AI Provider Keys */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>AI Providers</h2>
        <p className={styles.sectionDesc}>
          Configure your preferred AI providers for scripts, Q&amp;A, and discovery chat.
          Keys are encrypted with AES-256-GCM.
        </p>
        <AiProviderCards initialConfigured={configuredAiProviders} providerMeta={aiProviderMeta} />
      </section>

      {/* TTS Provider Keys */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Voice Providers</h2>
        <p className={styles.sectionDesc}>
          Add voice provider keys to use your preferred TTS models. Keys are encrypted with
          AES-256-GCM.
        </p>
        <TtsProviderCards
          initialConfigured={configuredTtsProviders}
          providerMeta={ttsProviderMeta}
        />
      </section>

      {/* Referrals */}
      {handle && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Referrals</h2>
          <p className={styles.sectionDescription}>
            Invite friends to self-host Sotto or join your instance.
          </p>

          <div className={styles.referralRow}>
            <Input value={`${new URL(appBaseUrl).host}/ref/${handle}`} readOnly />
            <Button
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(`${appBaseUrl}/ref/${handle}`);
              }}
            >
              Copy
            </Button>
          </div>

          {referredUsers.length > 0 && (
            <div className={styles.referralList}>
              <h3 className={styles.referralListTitle}>
                {referredUsers.length} {referredUsers.length === 1 ? 'person' : 'people'} joined via
                your link
              </h3>
              <ul className={styles.referralUsers}>
                {referredUsers.map((user) => (
                  <li key={user.handle ?? user.joinedAt} className={styles.referralUser}>
                    {user.image ? (
                      <Image
                        src={user.image}
                        alt=""
                        width={28}
                        height={28}
                        className={styles.referralAvatar}
                      />
                    ) : (
                      <span className={styles.referralAvatarFallback}>
                        {(user.name || user.handle || '?')[0].toUpperCase()}
                      </span>
                    )}
                    <span className={styles.referralName}>{user.name || `@${user.handle}`}</span>
                    <Badge variant={user.verified ? 'success' : 'default'}>
                      {user.verified ? 'Verified' : 'Pending'}
                    </Badge>
                    <span className={styles.referralDate}>
                      {new Date(user.joinedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

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
            <p className={styles.confirmText}>
              Are you sure? This will delete all your lessons, data, and cannot be reversed.
            </p>
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
