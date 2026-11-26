// All settings come from environment variables (see ../.env.example).
const env = process.env;

export const config = {
  port: Number(env.PORT || 8787),
  // Which classifier to use: "mock" (default, fake scores), "hive", or "sightengine".
  provider: (env.PROVIDER || 'mock').toLowerCase(),
  hiveApiKey: env.HIVE_API_KEY || '',
  sightengineUser: env.SIGHTENGINE_API_USER || '',
  sightengineSecret: env.SIGHTENGINE_API_SECRET || '',
  // Largest file the API will accept or download.
  maxBytes: Number(env.MAX_BYTES || 50 * 1024 * 1024),
  maxTextChars: Number(env.MAX_TEXT_CHARS || 20000),
  // Optional PEM file of trusted C2PA signing roots (e.g. the official C2PA trust list).
  c2paTrustAnchors: env.C2PA_TRUST_ANCHORS || '',
  // Only for local testing: lets the server fetch URLs on private networks.
  allowPrivateUrls: env.ALLOW_PRIVATE_URLS === 'true',
};
