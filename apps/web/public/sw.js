/* Service worker — PWA Técnico + Administración + Web Push */
const CACHE = 'isp-pwa-shell-v3'
const SHELL = [
  '/',
  '/login',
  '/movil',
  '/movil/',
  '/favicon.png',
  '/index.html',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // App shell: network-first, fallback cache (SPA)
  if (
    url.pathname === '/' ||
    url.pathname.startsWith('/movil') ||
    url.pathname.startsWith('/login') ||
    url.pathname.startsWith('/app') ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/recuperar') ||
    url.pathname.startsWith('/reset-password')
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          void caches.open(CACHE).then((c) => c.put(req, copy))
          return res
        })
        .catch(async () => {
          const cached = await caches.match(req)
          return cached || caches.match('/index.html')
        }),
    )
    return
  }

  // Assets estáticos: stale-while-revalidate ligero
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css')
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put(req, copy))
            return res
          })
          .catch(() => cached)
        return cached || network
      }),
    )
  }
})

self.addEventListener('push', (event) => {
  let data = {
    title: 'ISP Control',
    body: '',
    link: '/app',
    tag: 'isp-control',
  }
  try {
    if (event.data) {
      data = { ...data, ...event.data.json() }
    }
  } catch {
    try {
      data.body = event.data?.text() || ''
    } catch {
      // ignore
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'ISP Control', {
      body: data.body || '',
      tag: data.tag || 'isp-control',
      renotify: true,
      data: { link: data.link || '/app', notificationId: data.notificationId },
      icon: '/favicon.png',
      badge: '/favicon.png',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link =
    (event.notification.data && event.notification.data.link) || '/app'
  const url = new URL(link, self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(
      (clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus()
            if ('navigate' in client) {
              return client.navigate(url)
            }
            return undefined
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(url)
        }
        return undefined
      },
    ),
  )
})
