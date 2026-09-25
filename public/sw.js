self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let title = 'Medicine expiry reminder';
    let body = 'Open Medicine Tracker to review items due in the next 30 days.';
    try {
      const items = await fetch('/api/notifications', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : []);
      const unread = (items || []).filter(n => !n.read_at);
      if (unread.length === 1) {
        const days = unread[0].expiry_date ? Math.ceil((new Date(`${unread[0].expiry_date}T00:00:00`) - new Date()) / 86400000) : null;
        title = unread[0].name;
        body = days === 0 ? 'Expires today.' : `Expires in ${Math.max(0, days)} days.`;
      } else if (unread.length > 1) {
        title = `${unread.length} medicines need attention`;
        body = 'Open the app to review expiry reminders.';
      }
    } catch {
      /* still show a generic alert */
    }
    await self.registration.showNotification(title, { body, data: { url: '/#notifications' } });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/#notifications';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
