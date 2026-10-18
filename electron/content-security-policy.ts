/** Renderer API calls use IPC: no Backend origin belongs in connect-src. */
export function rendererCsp(developmentOrigin?: string, inlineScriptHashes: string[] = []): string {
  const connections = developmentOrigin
    ? `${developmentOrigin} ${developmentOrigin.replace(/^http/, 'ws')}`
    : "'none'"
  return [
    "default-src 'none'",
    `script-src 'self' ${inlineScriptHashes.map(hash => `'sha256-${hash}'`).join(' ')}`.trim(),
    "script-src-attr 'none'",
    `style-src 'self'${developmentOrigin ? " 'unsafe-inline'" : ''}`,
    "img-src 'self' https://res.cloudinary.com blob: data:",
    "font-src 'self'",
    `connect-src ${connections}`,
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}
