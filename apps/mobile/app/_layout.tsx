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
import { isAuthenticated, onAuthSuccess } from '../lib/auth';
import { onAuthRevoked } from '../lib/api';

const queryClient = new QueryClient();

function useProtectedRoute() {
  const segments = useSegments();
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  // Instant navigation on login/logout events
  useEffect(() => {
    const unsubRevoke = onAuthRevoked(() => {
      queryClient.clear();
      router.replace('/auth/login');
    });
    const unsubSuccess = onAuthSuccess(() => {
      router.replace('/(tabs)');
    });
    return () => { unsubRevoke(); unsubSuccess(); };
  }, [router]);

  // Auth check + navigation guard — always verifies SecureStore
  useEffect(() => {
    let cancelled = false;

    isAuthenticated().then((authed) => {
      if (cancelled) return;
      if (!isReady) setIsReady(true);

      const inAuthGroup = segments[0] === 'auth';
      if (!authed && !inAuthGroup) {
        router.replace('/auth/login');
      } else if (authed && inAuthGroup) {
        router.replace('/(tabs)');
      }
    });

    return () => { cancelled = true; };
  }, [segments, router, isReady]);

  return { isChecking: !isReady };
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
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="auth/login" options={{ headerShown: false }} />
            <Stack.Screen name="podcast/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="user/[userId]" options={{ title: '' }} />
          </Stack>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
