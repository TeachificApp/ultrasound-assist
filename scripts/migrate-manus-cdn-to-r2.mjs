#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const MANUS_CDN_HOST = "private-us-east-1.manuscdn.com";
const URL_PATTERN = new RegExp(
  `https://${MANUS_CDN_HOST.replaceAll(".", "\\.")}/[^\\s"'\\)<>]+`,
  "g"
);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".scss",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
]);

const SKIPPED_DIRS = new Set([
  ".git",
  ".manus",
  "coverage",
  "dist",
  "node_modules",
  "public",
  "build",
]);

const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
const STORAGE_KEY_PREFIX = "migrated-manus-cdn";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const rootDir = process.cwd();

loadDotEnv(path.join(rootDir, ".env"));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  const matches = await collectMatches(rootDir);
  const uniqueUrls = [...new Set(matches.flatMap((match) => match.urls))].sort();

  if (uniqueUrls.length === 0) {
    console.log("No Manus CDN URLs found.");
    return;
  }

  printDiscovery(matches, uniqueUrls);

  if (dryRun) {
    console.log("\nDry run complete. No assets uploaded and no files changed.");
    return;
  }

  const storageConfig = getStorageConfig();
  const replacements = new Map();

  for (const [index, url] of uniqueUrls.entries()) {
    const key = buildStorageKey(url);
    console.log(`\n[${index + 1}/${uniqueUrls.length}] Migrating ${assetName(url)}`);
    const { buffer, contentType } = await downloadAsset(url);
    const uploadedUrl = await uploadAsset(storageConfig, key, buffer, contentType);
    replacements.set(url, uploadedUrl);
    console.log(`  -> ${uploadedUrl}`);
  }

  const changedFiles = await rewriteFiles(matches, replacements);

  console.log(
    `\nMigration complete. Uploaded ${replacements.size} assets and updated ${changedFiles.length} files.`
  );
  for (const filePath of changedFiles) {
    console.log(`- ${path.relative(rootDir, filePath)}`);
  }
}

async function collectMatches(directory) {
  const filePaths = await collectTextFiles(directory);
  const matches = [];

  for (const filePath of filePaths) {
    const fileStat = await stat(filePath);
    if (fileStat.size > MAX_TEXT_FILE_BYTES) {
      continue;
    }

    const contents = await readFile(filePath, "utf8");
    const urls = contents.match(URL_PATTERN);
    if (urls?.length) {
      matches.push({
        filePath,
        urls: [...new Set(urls.map(stripTrailingPunctuation))].sort(),
      });
    }
  }

  return matches;
}

async function collectTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const filePaths = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        filePaths.push(...(await collectTextFiles(fullPath)));
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      filePaths.push(fullPath);
    }
  }

  return filePaths;
}

function printDiscovery(matches, uniqueUrls) {
  console.log(
    `Found ${uniqueUrls.length} unique Manus CDN URLs in ${matches.length} files.`
  );

  for (const match of matches) {
    console.log(`\n${path.relative(rootDir, match.filePath)}`);
    for (const url of match.urls) {
      console.log(`- ${assetName(url)} -> ${buildStorageKey(url)}`);
    }
  }
}

function getStorageConfig() {
  const baseUrl = process.env.BUILT_IN_FORGE_API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Missing Forge/R2 storage credentials. Set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY before running without --dry-run."
    );
  }

  return { baseUrl, apiKey };
}

async function downloadAsset(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${assetName(url)} (${response.status} ${response.statusText})`
    );
  }

  const contentType =
    response.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
}

async function uploadAsset({ baseUrl, apiKey }, key, buffer, contentType) {
  const uploadUrl = new URL("v1/storage/upload", `${baseUrl}/`);
  uploadUrl.searchParams.set("path", key);

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), path.basename(key));

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage upload failed for ${key} (${response.status} ${response.statusText}): ${message}`
    );
  }

  const json = await response.json();
  if (!json?.url || typeof json.url !== "string") {
    throw new Error(`Storage upload for ${key} did not return a URL.`);
  }

  return json.url;
}

async function rewriteFiles(matches, replacements) {
  const changedFiles = [];

  for (const match of matches) {
    const original = await readFile(match.filePath, "utf8");
    let updated = original;

    for (const [from, to] of replacements.entries()) {
      updated = updated.split(from).join(to);
    }

    if (updated !== original) {
      await writeFile(match.filePath, updated);
      changedFiles.push(match.filePath);
    }
  }

  return changedFiles;
}

function buildStorageKey(url) {
  const parsed = new URL(url);
  const filename = sanitizeFilename(path.posix.basename(parsed.pathname));
  const hash = createHash("sha256").update(parsed.pathname).digest("hex").slice(0, 12);
  return `${STORAGE_KEY_PREFIX}/${hash}-${filename}`;
}

function assetName(url) {
  const parsed = new URL(url);
  return path.posix.basename(parsed.pathname);
}

function sanitizeFilename(filename) {
  return decodeURIComponent(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function stripTrailingPunctuation(url) {
  return url.replace(/[.,;:]+$/, "");
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = unquoteEnvValue(rawValue);
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
