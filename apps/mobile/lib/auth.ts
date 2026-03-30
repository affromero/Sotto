import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'sotto_auth_token';

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    // SecureStore write failed — auth will work until app restart
  }
}

export async function deleteToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // SecureStore delete failed — token persists until overwritten
  }
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
