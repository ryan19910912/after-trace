self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// AFTERTRACE intentionally does not cache authenticated Record/API responses here.
// Offline data policy can be added later only with explicit product/security rules.
