import { afterEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalMysqlUrl = process.env.MYSQL_URL;

describe("environment configuration", () => {
  afterEach(() => {
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    if (originalMysqlUrl) {
      process.env.MYSQL_URL = originalMysqlUrl;
    } else {
      delete process.env.MYSQL_URL;
    }
    vi.resetModules();
  });

  it("uses MYSQL_URL as the Railway database fallback", async () => {
    delete process.env.DATABASE_URL;
    process.env.MYSQL_URL = "mysql://railway.example/db";
    vi.resetModules();

    const { ENV } = await import("./_core/env");

    expect(ENV.databaseUrl).toBe("mysql://railway.example/db");
  });

  it("prefers DATABASE_URL when both database variables are set", async () => {
    process.env.DATABASE_URL = "mysql://primary.example/db";
    process.env.MYSQL_URL = "mysql://railway.example/db";
    vi.resetModules();

    const { ENV } = await import("./_core/env");

    expect(ENV.databaseUrl).toBe("mysql://primary.example/db");
  });
});
