import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const awsMock = vi.hoisted(() => ({
  send: vi.fn(async () => ({})),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation((config) => ({ config, send: awsMock.send })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ command: "put", input })),
  DeleteObjectCommand: vi.fn().mockImplementation((input) => ({ command: "delete", input })),
}));

const originalEnv = {
  BUILT_IN_FORGE_API_URL: process.env.BUILT_IN_FORGE_API_URL,
  BUILT_IN_FORGE_API_KEY: process.env.BUILT_IN_FORGE_API_KEY,
  CLOUDFLARE_R2_ACCESS_KEY_ID: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
  CLOUDFARE_R2_ACCESS_KEY_ID: process.env.CLOUDFARE_R2_ACCESS_KEY_ID,
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  CLOUDFLARE_SECRET_ACCESS_KEY: process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
  CLOUDFLARE_R2_BUCKET_URL: process.env.CLOUDFLARE_R2_BUCKET_URL,
  CLOUDFLARE_R2_PUBLIC_BASE_URL: process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL,
  CLOUDFLARE_R2_BUCKET: process.env.CLOUDFLARE_R2_BUCKET,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("storage R2 configuration", () => {
  beforeEach(() => {
    delete process.env.BUILT_IN_FORGE_API_URL;
    delete process.env.BUILT_IN_FORGE_API_KEY;
    delete process.env.CLOUDFLARE_R2_BUCKET;
    delete process.env.CLOUDFARE_R2_ACCESS_KEY_ID;
    delete process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "r2-access";
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "r2-secret";
    process.env.CLOUDFLARE_R2_BUCKET_URL = "https://926e046281eccc776864fd105e322ac8.r2.cloudflarestorage.com/ultrasound-assist";
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL = "https://pub-1f4b81c70d1f49cb8817cc2abbb92288.r2.dev";
    awsMock.send.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    restoreEnv();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns public r2.dev URLs for stored keys", async () => {
    const { storageGet } = await import("./storage");

    const result = await storageGet("/case-media/user 1/image 1.png");

    expect(result).toEqual({
      key: "case-media/user 1/image 1.png",
      url: "https://pub-1f4b81c70d1f49cb8817cc2abbb92288.r2.dev/case-media/user%201/image%201.png",
    });
  });

  it("uploads to the configured R2 bucket endpoint", async () => {
    const { storagePut } = await import("./storage");
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");

    const result = await storagePut("uploads/test.png", Buffer.from("image"), "image/png");

    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "https://926e046281eccc776864fd105e322ac8.r2.cloudflarestorage.com",
      forcePathStyle: true,
      region: "auto",
      credentials: {
        accessKeyId: "r2-access",
        secretAccessKey: "r2-secret",
      },
    }));
    expect(PutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
      Bucket: "ultrasound-assist",
      Key: "uploads/test.png",
      ContentType: "image/png",
    }));
    expect(awsMock.send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      key: "uploads/test.png",
      url: "https://pub-1f4b81c70d1f49cb8817cc2abbb92288.r2.dev/uploads/test.png",
    });
  });

  it("deletes objects from the configured R2 bucket", async () => {
    const { storageDelete } = await import("./storage");
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");

    await storageDelete("/uploads/test.png");

    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: "ultrasound-assist",
      Key: "uploads/test.png",
    });
    expect(awsMock.send).toHaveBeenCalledTimes(1);
  });

  it("supports the Cloudflare secret aliases shown in Cursor secrets", async () => {
    delete process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    delete process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    process.env.CLOUDFARE_R2_ACCESS_KEY_ID = "alias-access";
    process.env.CLOUDFLARE_SECRET_ACCESS_KEY = "alias-secret";
    vi.resetModules();

    const { storagePut } = await import("./storage");
    const { S3Client } = await import("@aws-sdk/client-s3");

    await storagePut("uploads/alias.png", Buffer.from("image"), "image/png");

    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({
      credentials: {
        accessKeyId: "alias-access",
        secretAccessKey: "alias-secret",
      },
    }));
  });
});
