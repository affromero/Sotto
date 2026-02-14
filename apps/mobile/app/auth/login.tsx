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
import * as Linking from 'expo-linking';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../../lib/api';
import { setToken } from '../../lib/auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignIn = useCallback(async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    setErrorMessage('');
    setLoading(true);

    try {
      const res = await api.post('/auth/signin', {
        email: trimmedEmail,
        password,
      });
      const token = res.data?.token;
      if (!token) {
        setErrorMessage('Invalid response from server. Please try again.');
        return;
      }
      await setToken(token);
      router.replace('/(tabs)');
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string }; status?: number } };
      const status = axiosError.response?.status;
      const message = axiosError.response?.data?.error;

      if (status === 401) {
        setErrorMessage(message ?? 'Invalid email or password.');
      } else if (status === 429) {
        setErrorMessage('Too many attempts. Please wait a moment and try again.');
      } else {
        setErrorMessage(message ?? 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [email, password]);

  const handleSignUp = useCallback(() => {
    Linking.openURL('https://sotto.fm/auth/signup');
  }, []);

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

        {/* Form */}
        <View style={styles.formSection}>
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
              returnKeyType="next"
              accessibilityLabel="Email address"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              editable={!loading}
              returnKeyType="done"
              onSubmitEditing={handleSignIn}
              accessibilityLabel="Password"
            />
          </View>

          {errorMessage !== '' && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <Pressable
            onPress={handleSignIn}
            style={[styles.signInButton, loading && styles.signInButtonDisabled]}
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

        {/* Sign up link */}
        <View style={styles.footerSection}>
          <Text style={styles.footerText}>
            Don't have an account?{' '}
          </Text>
          <Pressable
            onPress={handleSignUp}
            accessibilityLabel="Sign up on sotto.fm"
            accessibilityRole="link"
          >
            <Text style={styles.signUpLink}>Sign up</Text>
          </Pressable>
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

  // Footer
  footerSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  footerText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
  },
  signUpLink: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
});
