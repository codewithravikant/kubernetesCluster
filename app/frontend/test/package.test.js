import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("frontend package", () => {
  it("has App entry and styles", () => {
    assert.ok(existsSync(join(root, "src/main.jsx")));
    assert.ok(existsSync(join(root, "src/App.jsx")));
    assert.ok(existsSync(join(root, "src/styles.css")));
  });

  it("App.jsx references metrics endpoints", () => {
    const src = readFileSync(join(root, "src/App.jsx"), "utf8");
    assert.match(src, /\/api\/metrics|metrics\/live|\/metrics/);
  });

  it("declares lint and build scripts", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(typeof pkg.scripts.build, "string");
    assert.equal(typeof pkg.scripts.lint, "string");
  });
});
