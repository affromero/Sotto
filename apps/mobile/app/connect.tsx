import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { connectToServer } from '../lib/connect';

export default function ConnectScreen() {
  const router = useRouter();
  const [serverUrl, setServerUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConnect = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      await connectToServer(serverUrl);
      router.replace('/auth/login');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect to that server.');
    } finally {
      setLoading(false);
    }
  }, [serverUrl, router]);

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.title}>Connect to your Sotto</Text>
          <Text style={styles.subtitle}>
            Enter the address of your self-hosted server — the same URL you open in a browser. You
            only do this once per device.
          </Text>

          <Text style={styles.label}>Server address</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://sotto.your-domain.com"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
            returnKeyType="go"
            onSubmitEditing={onConnect}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.button, (!serverUrl.trim() || loading) && styles.buttonDisabled]}
            onPress={onConnect}
            disabled={!serverUrl.trim() || loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={styles.buttonText}>Connect</Text>
            )}
          </Pressable>

          <Text style={styles.hint}>
            On the server, open Settings → Devices to show a pairing code.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  title: {
    fontFamily: typography.fontHeading,
    fontSize: 28,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 21,
  },
  label: {
    fontFamily: typography.fontBody,
    fontSize: 13,
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  error: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.warning,
    marginTop: spacing.sm,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  hint: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
