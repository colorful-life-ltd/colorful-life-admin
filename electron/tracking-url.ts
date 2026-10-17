/** Only open backend-generated tracking links on official carrier hosts. */
export function safeTrackingUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['www.royalmail.com', 'www.evri.com', 'www.dpd.co.uk'].includes(url.hostname) ? url.href : null
  } catch { return null }
}
