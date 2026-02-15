import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../../lib/api';
import { setToken } from '../../lib/auth';

const IS_DEV = __DEV__;
const GOOGLE_CONFIGURED = !!process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
const GITHUB_CONFIGURED = !!process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID;
const TWITTER_CONFIGURED = !!process.env.EXPO_PUBLIC_TWITTER_CLIENT_ID;

interface AuthResponse {
  token: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    handle: string | null;
    image: string | null;
    role: string;
  };
}

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDevSignIn = useCallback(async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    setErrorMessage('');
    setLoading(true);

    try {
      const res = await api.post<AuthResponse>('/auth/mobile', {
        email: trimmedEmail,
      });
      const { token } = res.data;
      if (!token) {
        setErrorMessage('Invalid response from server.');
        return;
      }
      await setToken(token);
      router.replace('/(tabs)');
    } catch (err: unknown) {
      const axiosError = err as {
        response?: { data?: { error?: string }; status?: number };
      };
      const status = axiosError.response?.status;
      const message = axiosError.response?.data?.error;

      if (status === 404) {
        setErrorMessage(
          message ?? 'No account found. Sign up on sotto.fm first.',
        );
      } else if (status === 429) {
        setErrorMessage('Too many attempts. Please wait and try again.');
      } else {
        setErrorMessage(message ?? 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [email]);

  const handleOAuthSignIn = useCallback(
    async (provider: 'apple' | 'google' | 'github' | 'twitter') => {
      setErrorMessage('');
      setLoading(true);

      try {
        let idToken: string;

        if (provider === 'apple') {
          const AppleAuthentication = await import('expo-apple-authentication');
          const credential =
            await AppleAuthentication.signInAsync({
              requestedScopes: [
                AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                AppleAuthentication.AppleAuthenticationScope.EMAIL,
              ],
            });
          if (!credential.identityToken) {
            setErrorMessage('Apple Sign In failed — no identity token.');
            return;
          }
          idToken = credential.identityToken;
        } else {
          const AuthSession = await import('expo-auth-session');
          const WebBrowser = await import('expo-web-browser');
          WebBrowser.maybeCompleteAuthSession();

          const configs: Record<
            string,
            { authorizationEndpoint: string; tokenEndpoint: string; scopes: string[] }
          > = {
            google: {
              authorizationEndpoint:
                'https://accounts.google.com/o/oauth2/v2/auth',
              tokenEndpoint: 'https://oauth2.googleapis.com/token',
              scopes: ['openid', 'profile', 'email'],
            },
            github: {
              authorizationEndpoint:
                'https://github.com/login/oauth/authorize',
              tokenEndpoint:
                'https://github.com/login/oauth/access_token',
              scopes: ['read:user', 'user:email'],
            },
            twitter: {
              authorizationEndpoint:
                'https://twitter.com/i/oauth2/authorize',
              tokenEndpoint: 'https://api.twitter.com/2/oauth2/token',
              scopes: ['users.read', 'tweet.read'],
            },
          };

          const config = configs[provider];
          const redirectUri = AuthSession.makeRedirectUri({ scheme: 'sotto' });
          const clientId =
            provider === 'google'
              ? process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? ''
              : provider === 'github'
                ? process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID ?? ''
                : process.env.EXPO_PUBLIC_TWITTER_CLIENT_ID ?? '';

          const request = new AuthSession.AuthRequest({
            clientId,
            redirectUri,
            scopes: config.scopes,
            responseType: AuthSession.ResponseType.Code,
            usePKCE: true,
          });

          const result = await request.promptAsync({
            authorizationEndpoint: config.authorizationEndpoint,
          });

          if (result.type !== 'success' || !result.params.code) {
            setErrorMessage('Sign in was cancelled.');
            return;
          }

          const tokenResult = await AuthSession.exchangeCodeAsync(
            {
              clientId,
              code: result.params.code,
              redirectUri,
              extraParams: {
                code_verifier: request.codeVerifier ?? '',
              },
            },
            { tokenEndpoint: config.tokenEndpoint },
          );

          idToken =
            tokenResult.idToken ?? tokenResult.accessToken ?? '';
        }

        if (!idToken) {
          setErrorMessage('Failed to get authentication token.');
          return;
        }

        const res = await api.post<AuthResponse>('/auth/mobile', {
          provider,
          idToken,
        });
        const { token } = res.data;
        if (!token) {
          setErrorMessage('Invalid response from server.');
          return;
        }
        await setToken(token);
        router.replace('/(tabs)');
      } catch (err: unknown) {
        const axiosError = err as {
          response?: { data?: { error?: string }; status?: number };
        };
        const message = axiosError.response?.data?.error;
        setErrorMessage(
          message ?? 'Sign in failed. Please try again.',
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Branding */}
        <View style={styles.brandSection}>
          <Text style={styles.logo}>Sotto</Text>
          <Text style={styles.tagline}>The Open Podcast Network</Text>
        </View>

        {IS_DEV ? (
          /* Dev Mode: Email-only login */
          <View style={styles.formSection}>
            <View style={styles.devBadge}>
              <Text style={styles.devBadgeText}>Dev Mode</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                editable={!loading}
                returnKeyType="done"
                onSubmitEditing={handleDevSignIn}
                accessibilityLabel="Email address"
              />
            </View>

            {errorMessage !== '' && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            <Pressable
              onPress={handleDevSignIn}
              style={[
                styles.signInButton,
                loading && styles.signInButtonDisabled,
              ]}
              disabled={loading}
              accessibilityLabel="Sign in"
              accessibilityRole="button"
            >
              {loading ? (
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <Text style={styles.signInButtonText}>Sign In</Text>
              )}
            </Pressable>
          </View>
        ) : (
          /* Production: OAuth buttons */
          <View style={styles.formSection}>
            {errorMessage !== '' && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            <Pressable
              onPress={() => handleOAuthSignIn('apple')}
              style={[styles.oauthButton, styles.oauthButtonApple]}
              disabled={loading}
              accessibilityLabel="Sign in with Apple"
              accessibilityRole="button"
            >
              <Text style={[styles.oauthButtonText, styles.oauthButtonTextApple]}>
                Sign in with Apple
              </Text>
            </Pressable>

            {GOOGLE_CONFIGURED && (
              <Pressable
                onPress={() => handleOAuthSignIn('google')}
                style={[styles.oauthButton, styles.oauthButtonGoogle]}
                disabled={loading}
                accessibilityLabel="Sign in with Google"
                accessibilityRole="button"
              >
                <Text style={styles.oauthButtonText}>
                  Sign in with Google
                </Text>
              </Pressable>
            )}

            {GITHUB_CONFIGURED && (
              <Pressable
                onPress={() => handleOAuthSignIn('github')}
                style={[styles.oauthButton, styles.oauthButtonGithub]}
                disabled={loading}
                accessibilityLabel="Sign in with GitHub"
                accessibilityRole="button"
              >
                <Text style={[styles.oauthButtonText, styles.oauthButtonTextApple]}>
                  Sign in with GitHub
                </Text>
              </Pressable>
            )}

            {TWITTER_CONFIGURED && (
              <Pressable
                onPress={() => handleOAuthSignIn('twitter')}
                style={[styles.oauthButton, styles.oauthButtonTwitter]}
                disabled={loading}
                accessibilityLabel="Sign in with Twitter"
                accessibilityRole="button"
              >
                <Text style={[styles.oauthButtonText, styles.oauthButtonTextApple]}>
                  Sign in with Twitter
                </Text>
              </Pressable>
            )}

            {loading && (
              <ActivityIndicator
                size="small"
                color={colors.primary}
                style={styles.oauthLoader}
              />
            )}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footerSection}>
          <Text style={styles.footerText}>
            By signing in, you agree to our{' '}
            <Text
              style={styles.footerLink}
              onPress={() => openBrowserAsync('https://sotto.fm/terms')}
              accessibilityRole="link"
            >
              Terms of Service
            </Text>
            {' '}and{' '}
            <Text
              style={styles.footerLink}
              onPress={() => openBrowserAsync('https://sotto.fm/privacy')}
              accessibilityRole="link"
            >
              Privacy Policy
            </Text>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing['2xl'],
  },

  // Branding
  brandSection: {
    alignItems: 'center',
    marginBottom: spacing['3xl'],
  },
  logo: {
    fontFamily: typography.fontHeading,
    fontSize: 48,
    color: colors.textPrimary,
  },
  tagline: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },

  // Form
  formSection: {
    width: '100%',
  },
  devBadge: {
    alignSelf: 'center',
    backgroundColor: colors.warningLighter,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginBottom: spacing.md,
  },
  devBadgeText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '600',
    color: colors.warning,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  input: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
  },
  errorContainer: {
    backgroundColor: colors.errorLighter,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.error,
    lineHeight: 20,
  },
  signInButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    marginTop: spacing.sm,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  signInButtonDisabled: {
    opacity: 0.6,
  },
  signInButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textInverse,
  },

  // OAuth buttons
  oauthButton: {
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    marginBottom: spacing.sm + 2,
    borderWidth: 1,
  },
  oauthButtonApple: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  oauthButtonGoogle: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  oauthButtonGithub: {
    backgroundColor: '#24292e',
    borderColor: '#24292e',
  },
  oauthButtonTwitter: {
    backgroundColor: '#1DA1F2',
    borderColor: '#1DA1F2',
  },
  oauthButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  oauthButtonTextApple: {
    color: '#FFFFFF',
  },
  oauthLoader: {
    marginTop: spacing.md,
  },

  // Footer
  footerSection: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  footerText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 18,
  },
  footerLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});
