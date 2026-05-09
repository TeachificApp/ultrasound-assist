export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl:
    process.env.DATABASE_URL ??
    process.env.MYSQL_URL ??
    process.env.railway_database_url ??
    "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  r2BucketUrl:
    process.env.CLOUDFLARE_R2_BUCKET_URL ??
    process.env.CLOUDFLARE_R2_BUCKET_API ??
    process.env.CLOUDFLARE_R2_S3 ??
    process.env.R2_BUCKET_URL ??
    "https://926e046281eccc776864fd105e322ac8.r2.cloudflarestorage.com/ultrasound-assist",
  r2PublicBaseUrl:
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL ??
    process.env.CLOUDFLARE_PUBLIC_DEVEL_URL ??
    process.env.R2_PUBLIC_BASE_URL ??
    "https://pub-1f4b81c70d1f49cb8817cc2abbb92288.r2.dev",
  r2AccessKeyId:
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ??
    process.env.CLOUDFARE_R2_ACCESS_KEY_ID ??
    process.env.R2_ACCESS_KEY_ID ??
    process.env.AWS_ACCESS_KEY_ID ??
    "",
  r2SecretAccessKey:
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ??
    process.env.CLOUDFLARE_SECRET_ACCESS_KEY ??
    process.env.CLOUDFARE_SECRET_ACCESS_KEY ??
    process.env.CLOUDFARER2_TOKENVALUE ??
    process.env.R2_SECRET_ACCESS_KEY ??
    process.env.AWS_SECRET_ACCESS_KEY ??
    "",
  r2Endpoint: process.env.CLOUDFLARE_R2_ENDPOINT ?? "",
  r2Bucket:
    process.env.CLOUDFLARE_R2_BUCKET ??
    process.env.CLOUDFLARE_BUCKET_NAME ??
    process.env.R2_BUCKET ??
    "",
  thinkificApiKey: process.env.THINKIFIC_API_KEY ?? "",
  thinkificSubdomain: process.env.THINKIFIC_SUBDOMAIN ?? "",
};
