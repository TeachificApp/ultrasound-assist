// Storage helpers used by uploads across the app. Prefer Cloudflare R2 so
// generated media URLs are independent of the Manus/Forge runtime.

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ENV } from './_core/env';

type ForgeStorageConfig = { baseUrl: string; apiKey: string };
type R2StorageConfig = {
  endpoint: string;
  bucket: string;
  publicBaseUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
};

let r2Client: S3Client | null = null;

function getForgeStorageConfig(): ForgeStorageConfig {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Storage proxy credentials missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function getR2StorageConfig(): R2StorageConfig | null {
  const bucketUrl =
    process.env.CLOUDFLARE_R2_BUCKET_URL ??
    process.env.CLOUDFLARE_R2_BUCKET_API ??
    process.env.CLOUDFLARE_R2_S3 ??
    process.env.R2_BUCKET_URL ??
    "";
  const endpoint =
    (process.env.CLOUDFLARE_R2_ENDPOINT ?? process.env.R2_ENDPOINT ?? "").replace(/\/+$/, "");
  const publicBaseUrl =
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL ??
    process.env.CLOUDFLARE_PUBLIC_DEVEL_URL ??
    process.env.R2_PUBLIC_BASE_URL ??
    "";
  const accessKeyId =
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ??
    process.env.CLOUDFARE_R2_ACCESS_KEY_ID ??
    process.env.R2_ACCESS_KEY_ID ??
    process.env.AWS_ACCESS_KEY_ID ??
    "";
  const secretAccessKey =
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ??
    process.env.CLOUDFLARE_SECRET_ACCESS_KEY ??
    process.env.CLOUDFARE_SECRET_ACCESS_KEY ??
    process.env.CLOUDFARER2_TOKENVALUE ??
    process.env.R2_SECRET_ACCESS_KEY ??
    process.env.AWS_SECRET_ACCESS_KEY ??
    "";

  let parsedEndpoint = endpoint;
  let bucket =
    process.env.CLOUDFLARE_R2_BUCKET ??
    process.env.CLOUDFLARE_BUCKET_NAME ??
    process.env.R2_BUCKET ??
    "";

  if (bucketUrl) {
    const parsed = new URL(bucketUrl);
    parsedEndpoint ||= parsed.origin;
    bucket ||= parsed.pathname.split("/").filter(Boolean)[0] ?? "";
  }

  if (!parsedEndpoint || !bucket || !publicBaseUrl || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    endpoint: parsedEndpoint,
    bucket,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ""),
    accessKeyId,
    secretAccessKey,
  };
}

function getR2Client(config: R2StorageConfig) {
  r2Client ??= new S3Client({
    region: process.env.CLOUDFLARE_R2_REGION ?? process.env.R2_REGION ?? "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return r2Client;
}

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

async function buildDownloadUrl(
  baseUrl: string,
  relKey: string,
  apiKey: string
): Promise<string> {
  const downloadApiUrl = new URL(
    "v1/storage/downloadUrl",
    ensureTrailingSlash(baseUrl)
  );
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
  });
  return (await response.json()).url;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function publicUrlForKey(publicBaseUrl: string, key: string) {
  return `${publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const r2Config = getR2StorageConfig();

  if (r2Config) {
    const client = getR2Client(r2Config);
    await client.send(new PutObjectCommand({
      Bucket: r2Config.bucket,
      Key: key,
      Body: typeof data === "string" ? Buffer.from(data) : Buffer.from(data),
      ContentType: contentType,
    }));
    return { key, url: publicUrlForKey(r2Config.publicBaseUrl, key) };
  }

  const { baseUrl, apiKey } = getForgeStorageConfig();
  const uploadUrl = buildUploadUrl(baseUrl, key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage upload failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  const url = (await response.json()).url;
  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string; }> {
  const key = normalizeKey(relKey);
  const r2Config = getR2StorageConfig();
  if (r2Config) {
    return { key, url: publicUrlForKey(r2Config.publicBaseUrl, key) };
  }

  const { baseUrl, apiKey } = getForgeStorageConfig();
  return {
    key,
    url: await buildDownloadUrl(baseUrl, key, apiKey),
  };
}

export async function storageDelete(relKey: string): Promise<void> {
  const key = normalizeKey(relKey);
  const r2Config = getR2StorageConfig();
  if (r2Config) {
    const client = getR2Client(r2Config);
    await client.send(new DeleteObjectCommand({ Bucket: r2Config.bucket, Key: key }));
    return;
  }

  const { baseUrl, apiKey } = getForgeStorageConfig();
  const deleteUrl = new URL("v1/storage/delete", ensureTrailingSlash(baseUrl));
  deleteUrl.searchParams.set("path", key);
  const response = await fetch(deleteUrl, {
    method: "DELETE",
    headers: buildAuthHeaders(apiKey),
  });
  // 404 is acceptable — file may already be gone
  if (!response.ok && response.status !== 404) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Storage delete failed (${response.status}): ${message}`);
  }
}
