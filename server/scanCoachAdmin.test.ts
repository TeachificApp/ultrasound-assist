/**
 * scanCoachAdmin.test.ts
 * Tests for the ScanCoach WYSIWYG admin router.
 * Covers: auth guard, listOverrides, upsertOverride, deleteOverride, clearImageField.
 * Note: uploadImage is not tested here as it requires a live S3 connection.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const dbMock = vi.hoisted(() => {
  type OverrideRow = Record<string, unknown> & { id: number };
  const state = {
    rows: [] as OverrideRow[],
    nextId: 1,
  };

  function collectFilters(condition: unknown, filters: Record<string, unknown>) {
    if (!condition || typeof condition !== "object") return;
    const chunk = condition as {
      queryChunks?: unknown[];
      encoder?: { name?: string };
      value?: unknown;
    };
    if (chunk.encoder?.name && "value" in chunk) {
      filters[chunk.encoder.name] = chunk.value;
      return;
    }
    if (Array.isArray(chunk.queryChunks)) {
      for (const child of chunk.queryChunks) collectFilters(child, filters);
    }
  }

  function filterRows(condition?: unknown) {
    if (!condition) return [...state.rows];
    const filters: Record<string, unknown> = {};
    collectFilters(condition, filters);
    return state.rows.filter((row) =>
      Object.entries(filters).every(([key, value]) => row[key] === value)
    );
  }

  function createSelectQuery() {
    let condition: unknown;
    const query = {
      from: vi.fn(() => query),
      where: vi.fn((nextCondition: unknown) => {
        condition = nextCondition;
        return query;
      }),
      orderBy: vi.fn(() => query),
      limit: vi.fn((count: number) => Promise.resolve(filterRows(condition).slice(0, count))),
      then: (resolve: (rows: OverrideRow[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(filterRows(condition)).then(resolve, reject),
    };
    return query;
  }

  function createDb() {
    return {
      select: vi.fn(() => createSelectQuery()),
      insert: vi.fn(() => ({
        values: vi.fn((payload: Record<string, unknown>) => {
          const id = state.nextId++;
          state.rows.push({ id, ...payload });
          return Promise.resolve([{ insertId: id, id }]);
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((payload: Record<string, unknown>) => ({
          where: vi.fn((condition: unknown) => {
            const filters: Record<string, unknown> = {};
            collectFilters(condition, filters);
            for (const row of state.rows) {
              if (Object.entries(filters).every(([key, value]) => row[key] === value)) {
                Object.assign(row, payload);
              }
            }
            return Promise.resolve(undefined);
          }),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn((condition: unknown) => {
          const filters: Record<string, unknown> = {};
          collectFilters(condition, filters);
          state.rows = state.rows.filter(
            (row) => !Object.entries(filters).every(([key, value]) => row[key] === value)
          );
          return Promise.resolve(undefined);
        }),
      })),
    };
  }

  return { state, createDb };
});

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: vi.fn(async () => dbMock.createDb()),
    getUserRoles: vi.fn(async () => []),
  };
});

// ─── Context helpers ──────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(overrides: Partial<AuthenticatedUser> = {}): TrpcContext {
  const user: AuthenticatedUser = {
    // Use a very high ID that will never exist in the DB (no DB roles)
    id: 999_999_001,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

/** Admin context: role === "admin" bypasses the DB role check */
function makeAdminCtx(): TrpcContext {
  return makeCtx({ role: "admin" });
}

/** Regular user context: role === "user", no DB roles (high ID) */
function makeUserCtx(): TrpcContext {
  return makeCtx({ role: "user" });
}

function makeUnauthCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  dbMock.state.rows = [];
  dbMock.state.nextId = 1;
});

describe("scanCoachAdmin.listOverrides", () => {
  // listOverrides is a publicProcedure — accessible by all users including unauthenticated
  it("allows unauthenticated callers (public procedure)", async () => {
    const caller = appRouter.createCaller(makeUnauthCtx());
    const result = await caller.scanCoachAdmin.listOverrides({ module: "abdominal" });
    expect(Array.isArray(result)).toBe(true);
  });

  it("allows non-admin users to read overrides (public procedure)", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    const result = await caller.scanCoachAdmin.listOverrides({ module: "venous" });
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns an array for admin users", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.scanCoachAdmin.listOverrides({ module: "fetal" });
    expect(Array.isArray(result)).toBe(true);
  });

  it("accepts all valid module values", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const modules = ["abdominal", "pelvic_gyn", "ob1", "ob23", "venous"] as const;
    for (const mod of modules) {
      const result = await caller.scanCoachAdmin.listOverrides({ module: mod });
      expect(Array.isArray(result)).toBe(true);
    }
  });

  it("returns all overrides when no module filter is provided", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.scanCoachAdmin.listOverrides({});
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("scanCoachAdmin.upsertOverride", () => {
  it("rejects non-admin users", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.scanCoachAdmin.upsertOverride({
        module: "abdominal",
        viewId: "liver",
        description: "Test description",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates a new override for admin", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.scanCoachAdmin.upsertOverride({
      module: "abdominal",
      viewId: `test-view-${Date.now()}`,
      viewName: "Test View",
      description: "Test override description",
      tips: JSON.stringify(["Tip 1", "Tip 2"]),
    });
    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("number");
    expect(result.created).toBe(true);
  });

  it("updates an existing override (upsert)", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const viewId = `upsert-test-${Date.now()}`;

    // First insert
    const first = await caller.scanCoachAdmin.upsertOverride({
      module: "venous",
      viewId,
      description: "Initial description",
    });
    expect(first.created).toBe(true);
    expect(typeof first.id).toBe("number");

    // Second call should update, not create
    const second = await caller.scanCoachAdmin.upsertOverride({
      module: "venous",
      viewId,
      description: "Updated description",
    });
    expect(second.created).toBe(false);
    // The ID should match the first insert
    expect(second.id).toBe(first.id);
  });

  it("rejects invalid module values", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(
      caller.scanCoachAdmin.upsertOverride({
        module: "invalid" as any,
        viewId: "liver",
      })
    ).rejects.toThrow();
  });
});

describe("scanCoachAdmin.deleteOverride", () => {
  it("rejects non-admin users", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.scanCoachAdmin.deleteOverride({ id: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("deletes an existing override", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const viewId = `delete-test-${Date.now()}`;

    // Create first
    const created = await caller.scanCoachAdmin.upsertOverride({
      module: "carotid",
      viewId,
      description: "To be deleted",
    });
    expect(typeof created.id).toBe("number");

    // Delete it
    const result = await caller.scanCoachAdmin.deleteOverride({ id: created.id });
    expect(result.deleted).toBe(true);
  });

  it("succeeds silently when deleting a non-existent ID", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.scanCoachAdmin.deleteOverride({ id: 999999 });
    expect(result.deleted).toBe(true);
  });
});

describe("scanCoachAdmin.clearImageField", () => {
  it("rejects non-admin users", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.scanCoachAdmin.clearImageField({ id: 1, field: "echoImageUrl" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("clears an image field on an existing override", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const viewId = `clear-test-${Date.now()}`;

    // Create with an image URL
    const created = await caller.scanCoachAdmin.upsertOverride({
      module: "msk",
      viewId,
      echoImageUrl: "https://example.com/image.png",
    });
    expect(typeof created.id).toBe("number");

    // Clear the echo image field
    const result = await caller.scanCoachAdmin.clearImageField({
      id: created.id,
      field: "echoImageUrl",
    });
    expect(result.cleared).toBe(true);
  });

  it("rejects invalid field names", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(
      caller.scanCoachAdmin.clearImageField({
        id: 1,
        field: "invalidField" as any,
      })
    ).rejects.toThrow();
  });
});
