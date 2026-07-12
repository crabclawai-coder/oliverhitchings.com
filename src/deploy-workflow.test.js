import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const workflowUrl = new URL("../.github/workflows/deploy.yml", import.meta.url);
const workerConfigUrl = new URL(
  "../contact-worker/wrangler.toml",
  import.meta.url,
);

describe("website deployment workflow", () => {
  it("installs ffprobe before checking the media budgets", async () => {
    const workflow = await readFile(workflowUrl, "utf8");
    const installStep = workflow.indexOf("- name: Install ffprobe");
    const mediaCheckStep = workflow.indexOf("- name: Check media budgets");

    expect(installStep).toBeGreaterThan(-1);
    expect(mediaCheckStep).toBeGreaterThan(installStep);

    const dependencySetup = workflow.slice(installStep, mediaCheckStep);

    expect(dependencySetup).toContain("apt-get install --yes ffmpeg");
    expect(dependencySetup).toContain("ffprobe -version");
  });

  it("requires Turnstile while leaving the unprovisioned rate limiter off", async () => {
    const workerConfig = await readFile(workerConfigUrl, "utf8");

    expect(workerConfig).toMatch(/^TURNSTILE_MODE\s*=\s*"enforce"\s*$/m);
    expect(workerConfig).toMatch(/^RATE_LIMIT_MODE\s*=\s*"off"\s*$/m);
  });
});
