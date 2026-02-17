import axios from 'axios';
import { getToken, deleteToken } from './auth';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://sotto.fm/api';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

type AuthRevokedListener = () => void;
const authRevokedListeners = new Set<AuthRevokedListener>();

export function onAuthRevoked(listener: AuthRevokedListener): () => void {
  authRevokedListeners.add(listener);
  return () => {
    authRevokedListeners.delete(listener);
  };
}

function notifyAuthRevoked() {
  authRevokedListeners.forEach((listener) => listener());
}

api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Only revoke auth if we actually sent a token and got 401 back.
    // Skip revocation for requests that had no token (pre-login background queries).
    if (error.response?.status === 401) {
      const hadToken = !!error.config?.headers?.Authorization;
      if (hadToken) {
        await deleteToken();
        notifyAuthRevoked();
      }
    }
    return Promise.reject(error);
  },
);
