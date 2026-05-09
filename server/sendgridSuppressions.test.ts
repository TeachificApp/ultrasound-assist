import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addToSendGridGlobalUnsubscribes } from "./lib/sendgridSuppressions";

const originalApiKey = process.env.SENDGRID_API_KEY;

describe("SendGrid suppression helpers", () => {
  beforeEach(() => {
    process.env.SENDGRID_API_KEY = "SG.test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 202 }))
    );
  });

  afterEach(() => {
    if (originalApiKey) {
      process.env.SENDGRID_API_KEY = originalApiKey;
    } else {
      delete process.env.SENDGRID_API_KEY;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes and deduplicates emails before adding global suppressions", async () => {
    await addToSendGridGlobalUnsubscribes([" TEST@example.com ", "test@example.com", ""]);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.body).toBe(JSON.stringify({ recipient_emails: ["test@example.com"] }));
  });

  it("batches global suppression requests to SendGrid's 1000-recipient limit", async () => {
    const emails = Array.from({ length: 1001 }, (_, index) => `user${index}@example.com`);

    await addToSendGridGlobalUnsubscribes(emails);

    expect(fetch).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    const secondBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string);
    expect(firstBody.recipient_emails).toHaveLength(1000);
    expect(secondBody.recipient_emails).toEqual(["user1000@example.com"]);
  });

  it("skips SendGrid calls when SENDGRID_API_KEY is missing", async () => {
    delete process.env.SENDGRID_API_KEY;

    await addToSendGridGlobalUnsubscribes(["test@example.com"]);

    expect(fetch).not.toHaveBeenCalled();
  });
});
