export function isStaticWebsiteOnly() {
  // Next.js inlines this public build flag. Full environment validation remains
  // in env.js/next.config.js; reading one string does not require it in clients.
  return process.env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true";
}
