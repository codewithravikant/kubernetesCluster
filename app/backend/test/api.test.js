import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/index.js";

describe("backend API", () => {
  let server;
  let base;

  before(async () => {
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address();
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (!server) return;
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("GET /health returns ok", async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "cluster-chronicles-backend");
    assert.equal(typeof body.hostname, "string");
  });

  it("GET /metrics returns infrastructure fields", async () => {
    const res = await fetch(`${base}/metrics`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.service, "cluster-chronicles-backend");
    assert.ok(body.memory);
    assert.ok(body.cpu);
    assert.ok(body.os);
    assert.equal(typeof body.uptimeSeconds, "number");
  });

  it("GET /metrics/live returns volatile fields only", async () => {
    const res = await fetch(`${base}/metrics/live`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.memory);
    assert.ok(body.loadAverage);
    assert.equal(body.os, undefined);
  });

  it("GET /metrics/prom returns Prometheus text with custom metric", async () => {
    await fetch(`${base}/metrics`);
    await fetch(`${base}/metrics/live`);
    const res = await fetch(`${base}/metrics/prom`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /chronicles_diagnostic_polls_total/);
    assert.match(text, /http_request_duration_seconds/);
  });
});
