import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const workflowUrl = new URL("../.github/workflows/deploy.yml", import.meta.url);

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
});
