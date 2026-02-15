import '../service';
import { useEffect, useState } from 'react';
import { Stack, useSegments, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import {
  DMSerifDisplay_400Regular,
} from '@expo-google-fonts/dm-serif-display';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { colors } from '@sotto/shared';
import { isAuthenticated } from '../lib/auth';
import { onAuthRevoked } from '../lib/api';

const queryClient = new QueryClient();

function useProtectedRoute() {
  const segments = useSegments();
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    isAuthenticated().then((authed) => {
      setIsAuthed(authed);
      setIsChecking(false);
    });
  }, []);

  // Listen for auth revocation (401 interceptor)
  useEffect(() => {
    const unsubscribe = onAuthRevoked(() => {
      setIsAuthed(false);
      queryClient.clear();
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (isChecking) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!isAuthed && !inAuthGroup) {
      router.replace('/auth/login');
    } else if (isAuthed && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isChecking, isAuthed, segments, router]);

  return { isChecking };
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'DM Serif Display': DMSerifDisplay_400Regular,
    'Inter': Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
  });

  const { isChecking } = useProtectedRoute();

  if (!fontsLoaded || isChecking) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.textPrimary,
              contentStyle: { backgroundColor: colors.background },
            }}
          />
        </QueryClientProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
