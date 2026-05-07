import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import express from "express";
import request from "supertest";

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  getUserByEmail: vi.fn(),
}));

vi.mock("../drizzle/schema", () => ({
  diySubscriptions: {},
  diyOrganizations: {},
  webhookEvents: {},
  lmsOrders: {},
  lmsEnrollments: {},
  lmsAffiliates: {},
  lmsAffiliateConversions: {},
  digitalPurchases: {},
  digitalBundlePurchases: {},
  digitalBundleItems: {},
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./routers/downloadsRouter", () => ({
  sendPurchaseConfirmationEmail: vi.fn().mockResolvedValue(undefined),
}));

function stripeSignature(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

async function buildApp(secret?: string) {
  vi.resetModules();
  if (secret) {
    process.env.STRIPE_WEBHOOK_SECRET = secret;
  } else {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  }
  const { registerStripeWebhook } = await import("./webhooks/stripe");
  const app = express();
  registerStripeWebhook(app);
  return app;
}

const checkoutEvent = {
  id: "evt_test",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test",
      amount_total: 1000,
      customer_email: "buyer@example.com",
    },
  },
};

describe("Stripe webhook signature verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests missing the stripe-signature header when a webhook secret is configured", async () => {
    const app = await buildApp("whsec_test");

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(checkoutEvent));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Missing signature" });
  });

  it("rejects requests with an invalid signature", async () => {
    const app = await buildApp("whsec_test");

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=123,v1=not-a-valid-digest")
      .send(JSON.stringify(checkoutEvent));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid signature" });
  });

  it("accepts a valid signed webhook payload", async () => {
    const secret = "whsec_test";
    const rawBody = JSON.stringify(checkoutEvent);
    const app = await buildApp(secret);

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", stripeSignature(secret, rawBody))
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});
