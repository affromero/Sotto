import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'sotto_auth_token';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function deleteToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getToken();
  return token !== null;
}

type AuthSuccessListener = () => void;
const authSuccessListeners = new Set<AuthSuccessListener>();

export function onAuthSuccess(listener: AuthSuccessListener): () => void {
  authSuccessListeners.add(listener);
  return () => {
    authSuccessListeners.delete(listener);
  };
}

export function notifyAuthSuccess() {
  authSuccessListeners.forEach((listener) => listener());
}
