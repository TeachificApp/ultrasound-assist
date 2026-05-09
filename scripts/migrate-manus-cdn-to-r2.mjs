#!/usr/bin/env node
/**
 * Copy Manus Forge CDN assets into the configured Cloudflare R2 bucket.
 *
 * Defaults are scoped to the All About Ultrasound bucket provided in this branch:
 *   Source: https://d2xsxph8kpxj0f.cloudfront.net/310519663401463434/UrcfdRVE8J6mpMNR48QuFe/
 *   R2 API: https://926e046281eccc776864fd105e322ac8.r2.cloudflarestorage.com/ultrasound-assist
 *   Public: https://pub-1f4b81c70d1f49cb8817cc2abbb92288.r2.dev
 *
 * Required to upload:
 *   CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY
 *   (R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY and AWS_* aliases also work)
 *
 * Optional:
 *   DATABASE_URL or MYSQL_URL        Discover every stored Manus CDN URL in the DB
 *   --manifest-file <path>           Include additional source URLs or relative keys from CSV/text
 *   --no-explicit-manifest           Skip the built-in explicit manifest
 *   --manifest-only                  Upload only the explicit manifest below
 *   --dry-run                        Print planned copies without downloading/uploading
 */
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { createPool } from "mysql2/promise";

const SOURCE_BASE =
  process.env.MANUS_CDN_BASE ??
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663401463434/UrcfdRVE8J6mpMNR48QuFe/";
const R2_BUCKET_URL =
  process.env.CLOUDFLARE_R2_BUCKET_URL ??
  process.env.CLOUDFLARE_R2_BUCKET_API ??
  process.env.CLOUDFLARE_R2_S3 ??
  process.env.R2_BUCKET_URL ??
  "https://926e046281eccc776864fd105e322ac8.r2.cloudflarestorage.com/ultrasound-assist";
const R2_PUBLIC_BASE_URL =
  process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL ??
  process.env.CLOUDFLARE_PUBLIC_DEVEL_URL ??
  process.env.R2_PUBLIC_BASE_URL ??
  "https://pub-1f4b81c70d1f49cb8817cc2abbb92288.r2.dev";
const R2_ACCESS_KEY_ID =
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ??
  process.env.CLOUDFARE_R2_ACCESS_KEY_ID ??
  process.env.R2_ACCESS_KEY_ID ??
  process.env.AWS_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY =
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ??
  process.env.CLOUDFLARE_SECRET_ACCESS_KEY ??
  process.env.CLOUDFARE_SECRET_ACCESS_KEY ??
  process.env.CLOUDFARER2_TOKENVALUE ??
  process.env.R2_SECRET_ACCESS_KEY ??
  process.env.AWS_SECRET_ACCESS_KEY;
const DATABASE_URL = process.env.DATABASE_URL ?? process.env.MYSQL_URL ?? process.env.railway_database_url;

const argv = process.argv.slice(2);
const args = new Set(argv);
const dryRun = args.has("--dry-run");
const manifestOnly = args.has("--manifest-only");
const includeExplicitManifest = !args.has("--no-explicit-manifest");
const skipExisting = !args.has("--overwrite");
const manifestFile = optionValue("--manifest-file", "--manifest", "--csv");

const explicitManifest = [
  // Scan Coach Images
  "scancoach/abdominal/aorta/echo-Abdominal-Aorta-Distal_Labels.png",
  "scancoach/abdominal/aorta/echo-Abdominal-Aorta-Labels.png",
  "scancoach/abdominal/gallbladder/echo-CBD1-label.png",
  "scancoach/abdominal/gallbladder/echo-Gallbladder_labels.png",
  "scancoach/abdominal/ivc/echo-IVC1-labels.png",
  "scancoach/abdominal/kidneys/echo-Left_Kidney-Spleen.jpg",
  "scancoach/abdominal/kidneys/echo-Right_Kidney-Labels.jpg",
  "scancoach/abdominal/liver/echo-LIVER1_portal_Veins.jpg",
  "scancoach/abdominal/liver/echo-LIVER2_Hep_Veins1.jpg",
  "scancoach/abdominal/liver/echo-LIVER_kidney.png",
  "scancoach/abdominal/pancreas/echo-Panc-Labels.png",
  "scancoach/abdominal/spleen/echo-Spleen-labels.png",
  "scancoach/pelvic_gyn/adnexa/echo-OV_TA-Doppler.jpg",
  "scancoach/pelvic_gyn/adnexa/echo-OV_TA.jpg",
  "scancoach/pelvic_gyn/cul_de_sac/echo-Uterus_-_CuldeSac-label.jpg",
  "scancoach/pelvic_gyn/uterus_sag/echo-Uterus_-_TV-labels.jpg",
  "scancoach/pelvic_gyn/uterus_sag/echo-Uterus_SAG-labels.jpg",

  // Media Repo / SCORM
  "media-repo/registry-review-quiz-physics-spi-unlimited-59a18a7b/v1-UNLIMITED REGISTRY REVIEW QUIZ - PHYSICS SPI.zip",
  "media-repo/lms-cover-1-1c5910bf/cover-1c5910bf.png",

  // Digital Download
  "digital-downloads/1/co5d1x-How to Start an Ultrasound Business.pdf",

  // LMS Images
  "lms-images/0e5015047b2e.png",
  "lms-images/8c05ebd71789.png",
];

function normalizeBase(base) {
  return base.endsWith("/") ? base : `${base}/`;
}

function optionValue(...names) {
  for (const name of names) {
    const index = argv.indexOf(name);
    if (index !== -1) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${name} requires a file path`);
      }
      return value;
    }

    const prefix = `${name}=`;
    const inline = argv.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
  }
  return null;
}

function parseR2BucketUrl(bucketUrl) {
  const parsed = new URL(bucketUrl);
  const bucketFromPath = parsed.pathname.split("/").filter(Boolean)[0];
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return {
    endpoint: (process.env.CLOUDFLARE_R2_ENDPOINT ?? "").replace(/\/+$/, "") || parsed.origin,
    bucket:
      process.env.CLOUDFLARE_R2_BUCKET ??
      process.env.CLOUDFLARE_BUCKET_NAME ??
      process.env.R2_BUCKET ??
      bucketFromPath ??
      "ultrasound-assist",
  };
}

function publicUrlForKey(key) {
  return `${R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function sourceUrlForKey(key) {
  return new URL(key, normalizeBase(SOURCE_BASE)).toString();
}

function keyFromSourceUrl(sourceUrl) {
  const base = normalizeBase(SOURCE_BASE);
  if (!sourceUrl.startsWith(base)) return null;
  return decodeURIComponent(sourceUrl.slice(base.length)).replace(/^\/+/, "");
}

function extractSourceUrls(value) {
  if (typeof value !== "string" || !value.includes(SOURCE_BASE.replace(/\/$/, ""))) return [];
  const escapedBase = SOURCE_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\/$/, "\\/?");
  const regex = new RegExp(`${escapedBase}[^"'\\\\\\s<>)]+`, "g");
  return value.match(regex) ?? [];
}

function parseDelimitedCells(value) {
  const cells = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    const next = value[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && (char === "," || char === "\t" || char === ";" || char === "\n" || char === "\r")) {
      cells.push(cell);
      cell = "";
      continue;
    }

    cell += char;
  }

  cells.push(cell);
  return cells;
}

async function loadManifestUrls(filePath) {
  if (!filePath) return [];

  const buffer = await readFile(filePath);
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    throw new Error(
      `${filePath} appears to be an XLSX/ZIP file. Export it as a real CSV/text file, or upload the original workbook without a .csv extension.`
    );
  }

  const text = buffer.toString("utf8");
  const urls = new Set(extractSourceUrls(text));
  const base = normalizeBase(SOURCE_BASE);
  const baseWithoutSlash = SOURCE_BASE.replace(/\/$/, "");
  const headerNames = new Set(["url", "urls", "source", "source_url", "source url", "key", "path", "file", "file_url", "file url"]);

  for (const rawCell of parseDelimitedCells(text)) {
    const cell = rawCell.trim().replace(/^\uFEFF/, "");
    if (!cell || headerNames.has(cell.toLowerCase())) continue;

    if (cell.startsWith(base) || cell.startsWith(baseWithoutSlash)) {
      urls.add(cell);
      continue;
    }

    if (/^https?:\/\//i.test(cell)) {
      console.warn(`[manifest] Skipping non-source URL: ${cell}`);
      continue;
    }

    if (cell.includes("/")) {
      urls.add(sourceUrlForKey(cell));
    }
  }

  return Array.from(urls);
}

async function discoverDbUrls() {
  if (!DATABASE_URL || manifestOnly) return [];

  const pool = createPool({
    uri: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectTimeout: 10000,
  });

  try {
    const [[dbRow]] = await pool.query("SELECT DATABASE() AS dbName");
    const databaseName = dbRow?.dbName;
    if (!databaseName) return [];

    const [columns] = await pool.query(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND DATA_TYPE IN ('varchar','text','mediumtext','longtext','json')`,
      [databaseName]
    );

    const urls = new Set();
    const likeValue = `%${SOURCE_BASE.replace(/\/$/, "")}%`;
    for (const { tableName, columnName } of columns) {
      const safeTable = `\`${String(tableName).replace(/`/g, "``")}\``;
      const safeColumn = `\`${String(columnName).replace(/`/g, "``")}\``;
      try {
        const [rows] = await pool.query(
          `SELECT ${safeColumn} AS value FROM ${safeTable} WHERE ${safeColumn} LIKE ? LIMIT 5000`,
          [likeValue]
        );
        for (const row of rows) {
          for (const url of extractSourceUrls(row.value)) urls.add(url);
        }
      } catch (err) {
        console.warn(`[discover] Skipping ${tableName}.${columnName}: ${err.message}`);
      }
    }
    return Array.from(urls);
  } finally {
    await pool.end();
  }
}

async function objectExists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === "NotFound") return false;
    throw err;
  }
}

async function copyAsset(client, bucket, item) {
  if (dryRun) {
    console.log(`[dry-run] ${item.sourceUrl} -> ${item.publicUrl}`);
    return { status: "dry-run", key: item.key };
  }

  if (skipExisting && await objectExists(client, bucket, item.key)) {
    console.log(`[skip] ${item.key} already exists`);
    return { status: "skipped", key: item.key };
  }

  const sourceResponse = await fetch(item.sourceUrl);
  if (!sourceResponse.ok) {
    throw new Error(`Download failed for ${item.sourceUrl}: HTTP ${sourceResponse.status}`);
  }

  const body = Buffer.from(await sourceResponse.arrayBuffer());
  const contentType = sourceResponse.headers.get("content-type") ?? "application/octet-stream";
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: item.key,
    Body: body,
    ContentType: contentType,
  }));

  console.log(`[copied] ${item.key} -> ${item.publicUrl}`);
  return { status: "copied", key: item.key };
}

async function main() {
  const explicitUrls = includeExplicitManifest ? explicitManifest.map(sourceUrlForKey) : [];
  const manifestUrls = await loadManifestUrls(manifestFile);
  const dbUrls = await discoverDbUrls();
  const urls = Array.from(new Set([...explicitUrls, ...manifestUrls, ...dbUrls]));
  const items = urls
    .map((sourceUrl) => {
      const key = keyFromSourceUrl(sourceUrl);
      return key ? { key, sourceUrl, publicUrl: publicUrlForKey(key) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.key.localeCompare(b.key));

  console.log(`Planned R2 migration items: ${items.length}`);
  console.log(`Explicit manifest items: ${explicitUrls.length}`);
  if (manifestFile) console.log(`Manifest file items: ${manifestUrls.length}`);
  if (!manifestOnly) console.log(`Discovered DB URLs: ${dbUrls.length}`);

  if (!dryRun && (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
    throw new Error("R2 credentials missing: set CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  }

  const { endpoint, bucket } = parseR2BucketUrl(R2_BUCKET_URL);
  const client = dryRun ? null : new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  const summary = { copied: 0, skipped: 0, failed: 0, dryRun: 0 };
  for (const item of items) {
    try {
      const result = await copyAsset(client, bucket, item);
      if (result.status === "copied") summary.copied++;
      if (result.status === "skipped") summary.skipped++;
      if (result.status === "dry-run") summary.dryRun++;
    } catch (err) {
      summary.failed++;
      console.error(`[failed] ${item.key}: ${err.message}`);
    }
  }

  console.log("Migration summary:", summary);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
