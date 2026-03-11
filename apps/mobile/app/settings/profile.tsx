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
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../../lib/api';
import { Avatar } from '../../components/Avatar';

interface UserProfile {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
  bio: string | null;
}

export default function ProfileEditScreen() {
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get('/users/me');
      return res.data;
    },
  });

  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [initialized, setInitialized] = useState(false);

  if (profile && !initialized) {
    setName(profile.name ?? '');
    setHandle(profile.handle ?? '');
    setBio(profile.bio ?? '');
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.patch('/users/me', {
        name: name.trim() || null,
        handle: handle.trim() || null,
        bio: bio.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', 'me'] });
      Alert.alert('Saved', 'Profile updated successfully.');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to update profile.');
    },
  });

  const handleCheckHandle = useCallback(async () => {
    if (!handle.trim()) return;
    try {
      const res = await api.get('/handles/check', {
        params: { handle: handle.trim() },
      });
      if (res.data.available) {
        Alert.alert('Available', `@${handle.trim()} is available!`);
      } else {
        Alert.alert('Taken', `@${handle.trim()} is already taken.`);
      }
    } catch {
      Alert.alert('Error', 'Could not check handle availability.');
    }
  }, [handle]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Edit Profile' }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Edit Profile' }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.avatarSection}>
          <Avatar uri={profile?.image} name={name} size={80} />
        </View>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={colors.textTertiary}
          maxLength={50}
          testID="profile-edit-name-input"
        />

        <Text style={styles.label}>Handle</Text>
        <View style={styles.handleRow}>
          <TextInput
            style={[styles.input, styles.handleInput]}
            value={handle}
            onChangeText={setHandle}
            placeholder="your-handle"
            placeholderTextColor={colors.textTertiary}
            maxLength={30}
            autoCapitalize="none"
            autoCorrect={false}
            testID="profile-edit-handle-input"
          />
          <Pressable style={styles.checkButton} onPress={handleCheckHandle} testID="profile-edit-check-handle">
            <Text style={styles.checkButtonText}>Check</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Bio</Text>
        <TextInput
          style={[styles.input, styles.bioInput]}
          value={bio}
          onChangeText={setBio}
          placeholder="Tell people about yourself"
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={200}
          testID="profile-edit-bio-input"
        />

        <Pressable
          style={[styles.saveButton, saveMutation.isPending && styles.saveButtonDisabled]}
          onPress={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          testID="profile-edit-save-button"
        >
          {saveMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Text style={styles.saveButtonText}>Save Changes</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  label: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
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
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.lg,
  },
  handleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  handleInput: {
    flex: 1,
    marginBottom: 0,
  },
  checkButton: {
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
  },
  checkButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
