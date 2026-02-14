import axios from 'axios';
import { getToken } from './auth';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://sotto.fm/api';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

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
    if (error.response?.status === 401) {
      await clearToken();
    }
    return Promise.reject(error);
  },
);

async function clearToken() {
  const { deleteToken } = await import('./auth');
  await deleteToken();
}
