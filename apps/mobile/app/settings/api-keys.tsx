import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../../lib/api';

interface KeyStatus {
  provider: string;
  isValid: boolean;
  lastUsedAt?: string | null;
  label?: string;
}

const AI_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'groq', name: 'Groq' },
] as const;

const TTS_PROVIDERS = [
  { id: 'elevenlabs', name: 'ElevenLabs', qualityTier: 'Premium' },
  { id: 'openai', name: 'OpenAI TTS', qualityTier: 'Standard' },
  { id: 'cartesia', name: 'Cartesia', qualityTier: 'Premium' },
  { id: 'hume', name: 'Hume', qualityTier: 'Ultra' },
  { id: 'fal', name: 'Fal', qualityTier: 'Premium' },
  { id: 'replicate', name: 'Replicate', qualityTier: 'Premium' },
] as const;

function ProviderRow({
  name,
  providerId,
  isValid,
  isConfigured,
  qualityTier,
  hasUserId,
  endpoint,
  onMutated,
}: {
  name: string;
  providerId: string;
  isValid: boolean;
  isConfigured: boolean;
  qualityTier?: string;
  endpoint: string;
  onMutated: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/settings/${endpoint}`, { provider: providerId, apiKey });
    },
    onSuccess: () => {
      setExpanded(false);
      setApiKey('');
      setError('');
      onMutated();
    },
    onError: (err: unknown) => {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error ?? 'Failed to save key');
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/settings/${endpoint}`, {
        data: { provider: providerId },
      });
    },
    onSuccess: () => {
      onMutated();
    },
    onError: () => {
      Alert.alert('Error', 'Failed to remove key');
    },
  });

  const handleRemove = useCallback(() => {
    Alert.alert('Remove Key', `Remove your ${name} API key?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeMutation.mutate(),
      },
    ]);
  }, [name, removeMutation]);

  const dotStyle = isConfigured
    ? isValid
      ? styles.statusDotActive
      : styles.statusDotInvalid
    : styles.statusDotInactive;

  return (
    <View style={styles.providerRow}>
      <View style={styles.providerHeader}>
        <View style={styles.providerInfoCol}>
          <View style={styles.providerNameRow}>
            <View style={[styles.statusDot, dotStyle]} />
            <Text style={styles.providerName}>{name}</Text>
          </View>
          {qualityTier && (
            <Text style={styles.qualityTierText}>{qualityTier}</Text>
          )}
        </View>
        {isConfigured ? (
          <View style={styles.configuredActions}>
            {!isValid && (
              <Pressable
                onPress={() => setExpanded(!expanded)}
                style={styles.updateButton}
              >
                <Text style={styles.updateButtonText}>
                  {expanded ? 'Cancel' : 'Update'}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={handleRemove}
              style={styles.removeButton}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <Text style={styles.removeButtonText}>Remove</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setExpanded(!expanded)}
            style={styles.addButton}
          >
            <Text style={styles.addButtonText}>
              {expanded ? 'Cancel' : 'Add Key'}
            </Text>
          </Pressable>
        )}
      </View>

      {expanded && (
        <View style={styles.expandedForm}>
          <TextInput
            style={styles.keyInput}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="Paste your API key"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          {error !== '' && (
            <Text style={styles.errorText}>{error}</Text>
          )}
          <Pressable
            style={[
              styles.saveButton,
              (!apiKey.trim() || saveMutation.isPending) && styles.saveButtonDisabled,
            ]}
            onPress={() => saveMutation.mutate()}
            disabled={!apiKey.trim() || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={styles.saveButtonText}>Save</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function ApiKeysScreen() {
  const queryClient = useQueryClient();

  const { data: aiKeys, isLoading: aiLoading } = useQuery<{ keys: KeyStatus[] }>({
    queryKey: ['settings', 'ai-keys'],
    queryFn: async () => {
      const res = await api.get('/settings/ai-keys');
      return res.data;
    },
  });

  const { data: ttsKeys, isLoading: ttsLoading } = useQuery<{ keys: KeyStatus[] }>({
    queryKey: ['settings', 'byok'],
    queryFn: async () => {
      const res = await api.get('/settings/byok');
      return res.data;
    },
  });

  const handleMutated = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['settings', 'ai-keys'] });
    queryClient.invalidateQueries({ queryKey: ['settings', 'byok'] });
  }, [queryClient]);

  const getKeyStatus = (keys: KeyStatus[] | undefined, provider: string) => {
    const entry = keys?.find((k) => k.provider === provider);
    return { isConfigured: !!entry, isValid: entry?.isValid ?? false };
  };

  const isLoading = aiLoading || ttsLoading;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'API Keys',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
        }}
      />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            <View style={styles.infoCard}>
              <Text style={styles.infoText}>
                Add your own API keys for unlimited generation, duration, and model
                choice. Keys are encrypted and never shared. Pro features like private
                podcasts and analytics require a separate subscription.
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>AI Providers</Text>
              <Text style={styles.sectionSubtitle}>
                AI is free — add your own key for faster models or higher limits
              </Text>
              <View style={styles.card}>
                {AI_PROVIDERS.map((p, i) => {
                  const status = getKeyStatus(aiKeys?.keys, p.id);
                  return (
                    <View key={p.id}>
                      {i > 0 && <View style={styles.separator} />}
                      <ProviderRow
                        name={p.name}
                        providerId={p.id}
                        isConfigured={status.isConfigured}
                        isValid={status.isValid}
                        endpoint="ai-keys"
                        onMutated={handleMutated}
                      />
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>TTS Providers</Text>
              <Text style={styles.sectionSubtitle}>
                Required for audio generation — at least one provider needed
              </Text>
              <View style={styles.card}>
                {TTS_PROVIDERS.map((p, i) => {
                  const status = getKeyStatus(ttsKeys?.keys, p.id);
                  return (
                    <View key={p.id}>
                      {i > 0 && <View style={styles.separator} />}
                      <ProviderRow
                        name={p.name}
                        providerId={p.id}
                        isConfigured={status.isConfigured}
                        isValid={status.isValid}
                        qualityTier={p.qualityTier}
                        endpoint="byok"
                        onMutated={handleMutated}
                      />
                    </View>
                  );
                })}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  centered: {
    paddingVertical: spacing['3xl'],
    alignItems: 'center',
  },
  infoCard: {
    backgroundColor: colors.primaryLighter,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  infoText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.primary,
    lineHeight: 20,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
    marginLeft: spacing.xs,
  },
  sectionSubtitle: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.md,
  },
  providerRow: {
    padding: spacing.md,
  },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  providerInfoCol: {
    flexDirection: 'column',
    gap: 1,
  },
  providerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  qualityTierText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
    marginLeft: 20,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusDotActive: {
    backgroundColor: colors.success,
  },
  statusDotInvalid: {
    backgroundColor: colors.error,
  },
  statusDotInactive: {
    backgroundColor: colors.border,
  },
  providerName: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textPrimary,
  },
  configuredActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  addButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  addButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  updateButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  updateButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  removeButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.error,
    minWidth: 70,
    alignItems: 'center',
  },
  removeButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.error,
  },
  expandedForm: {
    marginTop: spacing.md,
  },
  keyInput: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  keyInputExtra: {
    marginTop: spacing.sm,
  },
  errorText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.error,
    marginTop: spacing.xs,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
