// Required environment variables:
//
// GitHub OAuth app (https://github.com/settings/developers):
//   GITHUB_CLIENT_ID     — OAuth App Client ID
//   GITHUB_CLIENT_SECRET — OAuth App Client Secret
//   Callback URL must be set to: https://your-domain/api/oauth/callback
//
// Session / app:
//   JWT_SECRET           — Secret used to sign HS256 session JWTs
//   VITE_APP_ID          — Application identifier embedded in session tokens

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  appUrl: process.env.VITE_APP_URL ?? "https://app.allaboutultrasound.com",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  githubClientId: process.env.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  thinkificApiKey: process.env.THINKIFIC_API_KEY ?? "",
  thinkificSubdomain: process.env.THINKIFIC_SUBDOMAIN ?? "",
};
