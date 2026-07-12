import { access, readFile } from "node:fs/promises";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

const workflowUrl = new URL("../.github/workflows/deploy.yml", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);
const workerConfigUrl = new URL(
  "../contact-worker/wrangler.toml",
  import.meta.url,
);
const workerHandlerUrl = new URL(
  "../contact-worker/src/index.js",
  import.meta.url,
);
const legacyPagesHandlerUrl = new URL(
  "../functions/api/contact.js",
  import.meta.url,
);
const legacyPagesBuildUrl = new URL(
  "../scripts/build-pages-functions.mjs",
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
    const productionConfig = parse(workerConfig);

    expect(productionConfig.vars?.TURNSTILE_MODE).toBe("enforce");
    expect(productionConfig.vars?.RATE_LIMIT_MODE).toBe("off");
    expect(productionConfig.send_email).toEqual([{ name: "CONTACT_EMAIL" }]);
    expect(productionConfig.observability).toEqual({
      enabled: false,
      head_sampling_rate: 1,
      logs: {
        enabled: true,
        head_sampling_rate: 1,
        invocation_logs: true,
        persist: true,
      },
      traces: {
        enabled: false,
        head_sampling_rate: 1,
        persist: true,
      },
    });
  });

  it("keeps the protected Worker as the only contact backend", async () => {
    const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));

    await expect(access(workerHandlerUrl)).resolves.toBeUndefined();
    await expect(access(legacyPagesHandlerUrl)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(legacyPagesBuildUrl)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(packageJson.scripts?.build).toBe("astro build");
  });

  it("proves the built and deployed Pages site has no contact backend", async () => {
    const workflow = await readFile(workflowUrl, "utf8");
    const buildStep = workflow.indexOf("- name: Build production site");
    const staticArtifactStep = workflow.indexOf(
      "- name: Verify Pages artifact is static",
    );
    const deployStep = workflow.indexOf("- name: Deploy Pages");
    const liveBoundaryStep = workflow.indexOf(
      "- name: Verify the Pages hostname has no contact backend",
    );

    expect(staticArtifactStep).toBeGreaterThan(buildStep);
    expect(liveBoundaryStep).toBeGreaterThan(deployStep);
    expect(workflow).toContain("test ! -e dist/_worker.js");
    expect(workflow).toContain("test ! -e dist/_routes.json");
    expect(workflow).toContain(
      "https://oliverhitchings.pages.dev/api/contact",
    );
    expect(workflow).toContain('[[ "$status" == "404" ]]');
  });
});
