export function normalizeAsarEntryPath(entry) {
  return entry.replaceAll('\\', '/')
}

export function isForbiddenPackageEntry(entry) {
  return /(^|\/)(\.env[^/]*|src|electron|contracts|operator-intents|inventory-shipments|node_modules|\.git)(\/|$)/.test(entry)
}
