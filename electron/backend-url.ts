/** Fail closed without echoing configuration values, which may contain credentials. */
export function validateBackendUrl(value: string): string {
  const invalid = () => new Error('Invalid COLORFUL_LIFE_BACKEND_URL: use HTTPS, or HTTP on localhost, 127.0.0.1 or [::1], without credentials, query or fragment.')
  if (!/^https?:\/\//i.test(value) || /[\s\\?#]/.test(value)) throw invalid()
  let url: URL
  try { url = new URL(value) } catch { throw invalid() }
  const authority = value.slice(value.indexOf('://') + 3).split('/')[0]
  if (!authority || authority.endsWith(':') || url.port === '0' || url.username || url.password || authority.includes('@') || !url.hostname || !['https:', 'http:'].includes(url.protocol)) throw invalid()
  // Check the original authority too: URL parsing normalizes shorthand/octal IPv4 addresses.
  if (url.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(authority)) throw invalid()
  return url.href.replace(/\/+$/, '')
}
