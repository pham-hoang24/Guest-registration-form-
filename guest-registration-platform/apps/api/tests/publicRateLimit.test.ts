import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildTestAppWithEnv,
  seedFixtures,
  testDb,
  truncateAll,
  type TestFixtures,
} from "./helpers.js";

// rateLimitEnabled is false under NODE_ENV=test (see config.ts); force it on here
// so these tests actually exercise the limiter middleware.
const { app } = buildTestAppWithEnv({ NODE_ENV: "development" });
let fx: TestFixtures;

beforeEach(async () => {
  await truncateAll();
  fx = await seedFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("public registration-link rate limiters", () => {
  it("persists across requests on the same app instance: GET is 429 past the per-minute limit", async () => {
    const url = () => `/v1/public/registration-links/${fx.rawTokenA}`;
    let lastStatus = 0;
    // Limit is 60/minute; the 61st request in the same window must be throttled.
    // Before the fix, a fresh in-memory store was created per request and this
    // never happened, no matter how many requests were sent.
    for (let i = 0; i < 61; i++) {
      const res = await request(app).get(url());
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("persists across requests on the same app instance: POST is 429 past the per-minute limit", async () => {
    const url = `/v1/public/registration-links/${fx.rawTokenA}/submissions`;
    let lastStatus = 0;
    // Limit is 5/minute. The limiter runs before body parsing, so an empty POST
    // still counts against it.
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post(url).send();
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
