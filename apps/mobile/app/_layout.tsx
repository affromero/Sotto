import '../service';
import { useEffect, useRef, useState } from 'react';
import { Stack, useSegments, useRouter, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import { DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { isAuthenticated, onAuthSuccess } from '../lib/auth';
import { useThemeColors, useThemeStore } from '../lib/useThemeColors';
import { api, onAuthRevoked } from '../lib/api';
import { registerForPushNotifications } from '../lib/notifications';
import { EventProvider } from '../components/EventProvider';
import { MiniPlayer } from '../components/MiniPlayer';
import { AppErrorBoundary } from '../components/AppErrorBoundary';

const queryClient = new QueryClient();

function useProtectedRoute() {
  const segments = useSegments();
  const router = useRouter();
  const pathname = usePathname();
  const [isReady, setIsReady] = useState(false);

  // Track current path so we can restore it after re-auth
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const pendingPostAuthRoute = useRef<string | null>(null);

  // Instant navigation on login/logout events
  useEffect(() => {
    const unsubRevoke = onAuthRevoked(() => {
      // Remember where the user was before being kicked to login
      const current = pathnameRef.current;
      if (current && current !== '/auth/login') {
        pendingPostAuthRoute.current = current;
      }
      queryClient.clear();
      router.replace('/auth/login');
    });
    const unsubSuccess = onAuthSuccess(() => {
      // Return to where the user was, not always to the Feed
      const dest = pendingPostAuthRoute.current ?? '/(tabs)';
      pendingPostAuthRoute.current = null;
      router.replace(dest as Parameters<typeof router.replace>[0]);
      // Register push notification token after successful auth
      registerForPushNotifications().catch(() => {});
    });
    return () => {
      unsubRevoke();
      unsubSuccess();
    };
  }, [router]);

  // Startup auth check — runs once on mount.
  // Validates the token against the backend so stale tokens (e.g. after a DB
  // reset in dev) are caught at the loading spinner, not on the first
  // authenticated API call from a tab screen.
  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      const hasToken = await isAuthenticated();
      if (!hasToken) {
        if (!cancelled) {
          setIsReady(true);
          const inAuthGroup = segments[0] === 'auth';
          if (!inAuthGroup) router.replace('/auth/login');
        }
        return;
      }

      // Token exists locally — validate against the backend.
      // A 401 triggers the Axios interceptor: deleteToken() + notifyAuthRevoked().
      // The listener above handles the redirect.
      let userData: { hasCompletedOnboarding?: boolean } | null = null;
      try {
        const res = await api.get('/users/me');
        userData = res.data;
      } catch {
        // Network errors / timeouts → trust the local token.
        // Runtime 401s on other endpoints will be caught by the interceptor.
      }

      // Re-check in case the interceptor just deleted the token.
      const stillValid = await isAuthenticated();
      if (!cancelled) {
        setIsReady(true);
        if (stillValid) {
          const inAuthGroup = segments[0] === 'auth';
          const inOnboarding = segments[0] === 'onboarding';
          if (userData && userData.hasCompletedOnboarding === false && !inOnboarding) {
            router.replace('/onboarding');
          } else if (inAuthGroup) {
            router.replace('/(tabs)');
          }
          registerForPushNotifications().catch(() => {});
        }
        // If !stillValid: onAuthRevoked already queued router.replace('/auth/login')
      }
    }

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentional: runs once on mount

  return { isChecking: !isReady };
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'DM Serif Display': DMSerifDisplay_400Regular,
    Inter: Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
  });

  const colors = useThemeColors();
  const isDark = useThemeStore((s) => s.resolved === 'dark');
  const { isChecking } = useProtectedRoute();

  if (!fontsLoaded || isChecking) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <QueryClientProvider client={queryClient}>
            <EventProvider>
              <StatusBar style={isDark ? 'light' : 'dark'} />
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: colors.background },
                  headerTintColor: colors.textPrimary,
                  contentStyle: { backgroundColor: colors.background },
                }}
              >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="auth/login" options={{ headerShown: false }} />
                <Stack.Screen name="onboarding/index" options={{ headerShown: false }} />
                <Stack.Screen name="podcast/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="podcast/[id]/edit" options={{ title: 'Edit Podcast' }} />
                <Stack.Screen name="analytics" options={{ title: 'Analytics' }} />
                <Stack.Screen name="collections/index" options={{ title: 'Collections' }} />
                <Stack.Screen name="collections/[id]" options={{ title: '' }} />
              </Stack>
              <MiniPlayer />
            </EventProvider>
          </QueryClientProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
