// Minimal service worker for PWA installability (Add to Home Screen).
// No fetch handler - let the browser handle all requests natively for better performance.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
