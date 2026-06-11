// Sotto Service Worker
// Handles offline caching, push notifications, and background sync
// for the Sotto interactive podcast platform.

const CACHE_VERSION = 'sotto-v1';
const RUNTIME_CACHE = 'sotto-runtime-v1';
const MAX_RUNTIME_CACHE_ITEMS = 100;

// Core app shell files to cache on install.
// These are the minimum resources needed to render the app offline.
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/favicon.ico',
];

// ============================================
// INSTALL — Cache the app shell
// ============================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => {
        // Use addAll so if any file fails, install fails — this ensures
        // the cache is in a consistent state before activation.
        return cache.addAll(APP_SHELL);
      })
      .then(() => {
        // Skip waiting so the new service worker activates immediately
        // instead of waiting for all tabs to close.
        return self.skipWaiting();
      })
  );
});

// ============================================
// ACTIVATE — Clean old caches, claim clients
// ============================================
self.addEventListener('activate', (event) => {
  const allowedCaches = [CACHE_VERSION, RUNTIME_CACHE];

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => !allowedCaches.includes(name))
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        // Take control of all open tabs immediately rather than
        // waiting for navigation. This ensures the new service worker
        // handles fetches for pages that were loaded before activation.
        return self.clients.claim();
      })
  );
});

// ============================================
// FETCH — Route requests to the right strategy
// ============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Dev bypass: never cache on localhost — serving stale chunks while iterating
  // makes the dev server look broken. Let the browser fetch normally.
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return;
  }

  // Only handle same-origin requests and GET requests.
  // POST/PUT/DELETE should always go to the network.
  if (request.method !== 'GET') {
    return;
  }

  // Only handle requests from our own origin
  if (url.origin !== self.location.origin) {
    return;
  }

  // API calls: network-first with cache fallback
  if (url.pathname.startsWith('/api/v1/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets: cache-first with network fallback
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigation requests (HTML pages): network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Everything else: network-first
  event.respondWith(networkFirst(request));
});

// ============================================
// CACHING STRATEGIES
// ============================================

/**
 * Cache-first strategy: serve from cache if available, otherwise fetch
 * from network and cache the response. Best for static assets that
 * change infrequently (JS bundles, CSS, images, fonts).
 */
function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) {
      return cached;
    }

    return fetch(request)
      .then((response) => {
        // Only cache successful responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        return addToRuntimeCache(request, response);
      })
      .catch(() => {
        // If fetch fails and we have no cache, return a simple offline response
        // for non-critical assets
        return new Response('', { status: 503, statusText: 'Offline' });
      });
  });
}

/**
 * Network-first strategy: try the network, fall back to cache.
 * Best for API calls and dynamic content that should be fresh
 * when possible but available offline when not.
 */
function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      // Only cache successful GET responses
      if (response && response.status === 200 && response.type === 'basic') {
        addToRuntimeCache(request, response.clone());
      }
      return response;
    })
    .catch(() => {
      return caches.match(request);
    });
}

/**
 * Network-first strategy for navigation requests (HTML pages).
 * If the network is unavailable, serve the cached app shell so
 * the user sees something rather than the browser's offline page.
 */
function networkFirstNavigation(request) {
  return fetch(request)
    .then((response) => {
      // Cache the page for offline use
      if (response && response.status === 200) {
        const responseClone = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => {
          cache.put(request, responseClone);
        });
      }
      return response;
    })
    .catch(() => {
      // Try the specific page first, then fall back to the cached app shell
      return caches.match(request).then((cached) => {
        if (cached) {
          return cached;
        }
        // Return the cached root page as a fallback app shell
        return caches.match('/');
      });
    });
}

// ============================================
// CACHE HELPERS
// ============================================

/**
 * Check if a URL path points to a static asset that benefits
 * from cache-first loading.
 */
function isStaticAsset(pathname) {
  // Next.js static assets
  if (pathname.startsWith('/_next/static/')) {
    return true;
  }

  // Next.js image optimization
  if (pathname.startsWith('/_next/image')) {
    return true;
  }

  // Font files
  if (pathname.startsWith('/fonts/')) {
    return true;
  }

  // Static file extensions
  const staticExtensions = [
    '.js',
    '.css',
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    '.eot',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.ico',
    '.webp',
    '.avif',
    '.mp3',
    '.wav',
    '.ogg',
    '.webm',
  ];

  return staticExtensions.some((ext) => pathname.endsWith(ext));
}

/**
 * Add a response to the runtime cache, enforcing the maximum
 * cache size to prevent unbounded storage growth.
 */
function addToRuntimeCache(request, response) {
  const responseClone = response.clone();

  caches.open(RUNTIME_CACHE).then((cache) => {
    cache.put(request, responseClone);

    // Enforce cache size limit by removing the oldest entries
    trimCache(RUNTIME_CACHE, MAX_RUNTIME_CACHE_ITEMS);
  });

  return response;
}

/**
 * Trim a cache to the specified maximum number of entries.
 * Removes entries in FIFO order (oldest first).
 */
function trimCache(cacheName, maxItems) {
  caches.open(cacheName).then((cache) => {
    cache.keys().then((keys) => {
      if (keys.length > maxItems) {
        // Delete the oldest entry, then recurse if still over limit
        cache.delete(keys[0]).then(() => {
          if (keys.length - 1 > maxItems) {
            trimCache(cacheName, maxItems);
          }
        });
      }
    });
  });
}

// ============================================
// PUSH NOTIFICATIONS
// ============================================

/**
 * Handle incoming push notifications. The payload is expected to be
 * a JSON string with the shape:
 * {
 *   title: string,
 *   body: string,
 *   url?: string,
 *   data?: Record<string, string>
 * }
 *
 * This matches the payload sent by src/lib/push-notifications.ts
 */
self.addEventListener('push', (event) => {
  if (!event.data) {
    console.warn('[SW] Push event received with no data');
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch (err) {
    console.error('[SW] Failed to parse push payload:', err);
    return;
  }

  const title = payload.title || 'Sotto';
  const options = {
    body: payload.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: payload.data?.type || 'sotto-notification',
    // Renotify if a notification with the same tag is received,
    // so the user sees the updated content.
    renotify: true,
    data: {
      url: payload.url || '/',
      ...payload.data,
    },
    actions: [
      {
        action: 'open',
        title: 'Open',
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
      },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Handle notification click. Opens the URL from the notification data
 * in a new tab, or focuses an existing tab if one is already open
 * at that URL.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // If the user clicked the dismiss action, do nothing further
  if (event.action === 'dismiss') {
    return;
  }

  const targetUrl = event.notification.data?.url || '/';
  const fullUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window with the target URL is already open, focus it
      for (const client of clientList) {
        if (client.url === fullUrl && 'focus' in client) {
          return client.focus();
        }
      }

      // If any Sotto window is open, navigate it to the target URL
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin && 'navigate' in client) {
          return client.navigate(fullUrl).then((client) => client.focus());
        }
      }

      // Otherwise, open a new window
      return self.clients.openWindow(fullUrl);
    })
  );
});

/**
 * Handle notification close (user dismissed it without clicking).
 * This is a no-op for now but provides a hook for future analytics.
 */
self.addEventListener('notificationclose', (event) => {
  // Future: track notification dismissal for analytics
  console.debug('[SW] Notification closed:', event.notification.tag);
});

// ============================================
// MESSAGE HANDLER
// ============================================

/**
 * Handle messages from the main thread. Supports:
 * - { type: 'SKIP_WAITING' } — force the waiting service worker to activate
 * - { type: 'CACHE_URLS', urls: string[] } — pre-cache specific URLs
 * - { type: 'CLEAR_CACHE' } — clear all caches
 */
self.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) {
    return;
  }

  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CACHE_URLS':
      if (Array.isArray(event.data.urls)) {
        event.waitUntil(
          caches.open(RUNTIME_CACHE).then((cache) => {
            return cache.addAll(event.data.urls);
          })
        );
      }
      break;

    case 'CLEAR_CACHE':
      event.waitUntil(
        caches.keys().then((names) => {
          return Promise.all(names.map((name) => caches.delete(name)));
        })
      );
      break;
  }
});
