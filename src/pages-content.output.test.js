import { JSDOM } from "jsdom";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = new URL("../", import.meta.url);
const guidePriceNote =
  "Guide prices. VAT, third-party software, model usage and hosting are separate where they apply.";

let buildDirectory;
let temporaryDirectory;
let home;
let services;

const clean = (value) => value?.replace(/\s+/g, " ").trim() ?? "";

async function readPage(filePath) {
  const html = await readFile(join(buildDirectory, filePath), "utf8");
  return new JSDOM(html).window.document;
}

function buildInIsolatedProcess({ cwd, outDir, root }) {
  const astroModuleUrl = import.meta.resolve("astro");
  const source = `
    import { build } from ${JSON.stringify(astroModuleUrl)};

    await build(${JSON.stringify({
      cacheDir: join(cwd, "astro-cache"),
      logLevel: "silent",
      outDir,
      root,
    })});
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", source],
      {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    let stdout = "";
    let timedOut = false;

    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 60_000);

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject(new Error("Isolated Astro build timed out after 60000ms."));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `Isolated Astro build failed (exit ${code}, signal ${signal ?? "none"}).\n` +
              `stdout:\n${stdout || "<empty>"}\n` +
              `stderr:\n${stderr || "<empty>"}`,
          ),
        );
        return;
      }

      resolve();
    });
  });
}

beforeAll(async () => {
  temporaryDirectory = await realpath(
    await mkdtemp(join(tmpdir(), "oliverhitchings-pages-content-")),
  );
  buildDirectory = join(temporaryDirectory, "dist");
  await symlink(
    join(fileURLToPath(projectRoot), "node_modules"),
    join(temporaryDirectory, "node_modules"),
  );

  await buildInIsolatedProcess({
    cwd: temporaryDirectory,
    outDir: buildDirectory,
    root: fileURLToPath(projectRoot),
  });

  home = await readPage("index.html");
  services = await readPage("services/index.html");
}, 60_000);

afterAll(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("generated homepage content", () => {
  it("leads with Oliver's identity, the owned-system thesis, and direct actions", () => {
    const hero = home.querySelector(".home-hero");

    expect(home.querySelectorAll("h1")).toHaveLength(1);
    expect(clean(hero?.querySelector(".eyebrow")?.textContent)).toBe(
      "Oliver Hitchings · Automation systems",
    );
    expect(clean(hero?.querySelector("h1")?.textContent)).toBe(
      "Small automation systems your team can inspect and own.",
    );
    expect(clean(hero?.querySelector(".home-hero__intro")?.textContent)).toBe(
      "I turn repeat business work into controlled loops with clear inputs, human review, visible logs and a practical handover.",
    );
    expect(
      hero?.querySelector("a[href='/services#contact']")?.textContent.trim(),
    ).toBe("Start an enquiry");
    expect(hero?.querySelector("a[href='#packages']")?.textContent.trim()).toBe(
      "View packages",
    );
    expect(clean(hero?.querySelector(".availability")?.textContent)).toBe(
      "Accepting 1 client",
    );
  });

  it("shows the operator trace and the five owned-loop stages in order", () => {
    const traceStates = Array.from(
      home.querySelectorAll("[data-trace-state]"),
      (node) => clean(node.querySelector("strong")?.textContent),
    );
    const traceText = clean(
      home.querySelector("[aria-label='Operator trace']")?.textContent,
    );
    const loopStages = Array.from(
      home.querySelectorAll("[data-loop-stage] h3"),
      (node) => clean(node.textContent),
    );

    expect(traceStates).toEqual(["Input", "Review", "Action", "Evidence"]);
    expect(traceText).toContain("repeat task or source material");
    expect(traceText).toContain("uncertain or consequential steps");
    expect(traceText).toContain("approved next step runs");
    expect(traceText).toContain("result or failure state logged");
    expect(loopStages).toEqual([
      "01 Intake",
      "02 Classify",
      "03 Human review",
      "04 Action",
      "05 Evidence",
    ]);
  });

  it("uses only the two verified proof-rail facts", () => {
    const proofItems = Array.from(home.querySelectorAll("[data-proof-item]"));

    expect(proofItems).toHaveLength(2);
    expect(clean(proofItems[0]?.textContent)).toBe(
      "1 One workflow is selected before a build begins.",
    );
    expect(clean(proofItems[1]?.textContent)).toBe(
      "3 Build handover assets: prompts, logs and a runbook.",
    );
  });

  it("labels three transparent system patterns without client-work framing", () => {
    const section = home.querySelector("[data-patterns]");
    const patterns = Array.from(
      section?.querySelectorAll("[data-pattern]") ?? [],
      (node) => clean(node.textContent),
    );

    expect(clean(section?.querySelector("h2")?.textContent)).toBe(
      "Three useful shapes for repeat work.",
    );
    expect(clean(section?.querySelector(".pattern-disclosure")?.textContent)).toBe(
      "These are example system patterns, not client case studies.",
    );
    expect(patterns).toHaveLength(3);
    expect(patterns[0]).toMatch(
      /Inbox triage.*classify.*route.*prepare for review.*final sending stays with a person/i,
    );
    expect(patterns[1]).toMatch(
      /Research monitoring.*named sources.*remove duplicates.*review queue/i,
    );
    expect(patterns[2]).toMatch(
      /Recurring reporting.*scheduled inputs.*flag gaps.*source trail/i,
    );
  });

  it("retains the four prices, neutral note, principles, and focused final action", () => {
    const packages = home.getElementById("packages");
    const packageText = clean(packages?.textContent);
    const principles = home.querySelector("[data-operating-principles]");
    const finalCta = home.querySelector(".home-final-cta");

    expect(clean(packages?.querySelector("h2")?.textContent)).toBe(
      "Choose the smallest useful first step.",
    );
    expect(packageText).toContain("Fixed scope Task Map £250");
    expect(packageText).toContain("Focused implementation First Build £500");
    expect(packageText).toContain("Connected workflow Operator System £1,000");
    expect(packageText).toContain("Optional retainer from £100/month");
    expect(packageText).toContain(guidePriceNote);
    expect(
      packages?.querySelectorAll("a:not([href='/services#contact'])"),
    ).toHaveLength(0);
    expect(clean(principles?.querySelector("h2")?.textContent)).toBe(
      "A system should make sense on a bad day.",
    );
    expect(clean(principles?.textContent)).toMatch(
      /Inspectability.*Failure handling.*Handover/,
    );
    expect(clean(finalCta?.querySelector("h2")?.textContent)).toBe(
      "Send the task, the tools and the review point.",
    );
    expect(finalCta?.querySelectorAll("a")).toHaveLength(1);
    expect(finalCta?.querySelector("a")?.getAttribute("href")).toBe(
      "/services#contact",
    );
  });
});

describe("generated Services content", () => {
  it("presents the right-sized method as a text trace and editorial rows", () => {
    const hero = services.querySelector(".services-hero");
    const method = services.querySelector("[data-services-method]");
    const methodRows = Array.from(
      method?.querySelectorAll("[data-method-step]") ?? [],
      (node) => clean(node.textContent),
    );

    expect(services.querySelectorAll("h1")).toHaveLength(1);
    expect(clean(hero?.querySelector("h1")?.textContent)).toBe(
      "Start with one repeat task and the right-sized first step.",
    );
    expect(clean(hero?.querySelector(".services-hero__intro")?.textContent)).toBe(
      "Choose a mapping sprint, a focused build or a wider operator system. Each option has visible scope, pricing and handover.",
    );
    expect(clean(hero?.querySelector(".method-trace")?.textContent)).toBe(
      "Map → Build → Hand over",
    );
    expect(hero?.querySelector("a[href='#packages']")?.textContent.trim()).toBe(
      "Compare packages",
    );
    expect(hero?.querySelector("a[href='#contact']")?.textContent.trim()).toBe(
      "Start an enquiry",
    );
    expect(clean(method?.querySelector("h2")?.textContent)).toBe(
      "Map the work before building the loop.",
    );
    expect(methodRows).toHaveLength(3);
    expect(methodRows[0]).toMatch(
      /Map.*trigger.*inputs.*owner.*approvals.*failure states/i,
    );
    expect(methodRows[1]).toMatch(
      /Build.*narrow loop.*review.*logs.*stop conditions/i,
    );
    expect(methodRows[2]).toMatch(
      /Hand over.*prompts.*logs.*run instructions.*change notes/i,
    );
  });

  it("retains package prices and explicit deliverables", () => {
    const packages = services.getElementById("packages");
    const text = clean(packages?.textContent);

    expect(text).toContain("Fixed scope Task Map £250");
    expect(text).toContain("Focused implementation First Build £500");
    expect(text).toContain("Connected workflow Operator System £1,000");
    expect(text).toContain("Run guide plus two review sessions after first use");
    expect(text).toContain("30-day improvement period after launch");
    expect(text).toContain("Optional retainer from £100/month");
    expect(text).toContain(guidePriceNote);
  });

  it("explains good-fit criteria and what stays with the owner", () => {
    const goodFit = services.querySelector("[data-good-fit]");
    const handover = services.querySelector("[data-handover]");

    expect(clean(goodFit?.querySelector("h2")?.textContent)).toBe(
      "Frequent enough to matter. Clear enough to inspect.",
    );
    expect(clean(goodFit?.textContent)).toMatch(
      /Frequent.*Structured.*Reviewable.*Contained/,
    );
    expect(clean(handover?.querySelector("h2")?.textContent)).toBe(
      "What stays with the owner.",
    );
    expect(clean(handover?.textContent)).toMatch(
      /First Build and Operator System.*prompts.*run instructions.*logs.*review rules.*failure states.*owner notes/i,
    );
    expect(clean(handover?.textContent)).toMatch(
      /Task Map.*process map.*build recommendation/i,
    );
  });

  it("preserves the complete enquiry form contract and honest visible copy", () => {
    const section = services.getElementById("contact");
    const form = section?.querySelector("form[data-contact-form]");
    const options = Array.from(
      form?.querySelectorAll("select[name='package_interest'] option") ?? [],
      (option) => option.value,
    );

    expect(clean(section?.querySelector("h2")?.textContent)).toBe(
      "Describe the repeat task.",
    );
    expect(clean(section?.querySelector(".contact-intro")?.textContent)).toBe(
      "Tell me what happens now, which tools are involved, who checks the output and what a useful result would look like. This form sends the enquiry directly from the website.",
    );
    expect(form?.getAttribute("action")).toBe("/api/contact");
    expect(form?.getAttribute("method")).toBe("POST");
    expect(form?.getAttribute("aria-describedby")).toBe("contact-form-status");
    expect(form?.querySelector("input[name='_honey']")).not.toBeNull();
    expect(
      form?.querySelector("input[name='name'][type='text'][required]"),
    ).not.toBeNull();
    expect(
      form?.querySelector("input[name='email'][type='email'][required]"),
    ).not.toBeNull();
    expect(
      form?.querySelector("input[name='contact_number'][type='tel']"),
    ).not.toBeNull();
    expect(clean(form?.querySelector("input[name='contact_number']")?.closest("label")?.querySelector("span")?.textContent)).toBe(
      "Contact number (optional)",
    );
    expect(
      form?.querySelector("select[name='package_interest'][required]"),
    ).not.toBeNull();
    expect(options).toEqual([
      "",
      "Task Map",
      "First Build",
      "Operator System",
      "Ongoing support",
      "Not sure yet",
    ]);
    expect(
      form?.querySelector("textarea[name='automation_request'][required]"),
    ).not.toBeNull();
    expect(form?.querySelector("textarea[name='tools_involved']")).not.toBeNull();
    expect(
      form?.querySelector(
        "#contact-form-status[role='status'][aria-live='polite'][aria-atomic='true'][data-contact-status]",
      ),
    ).not.toBeNull();
  });
});

describe("generated page truthfulness and media", () => {
  it("removes stale or unverified framing from both pages", () => {
    for (const document of [home, services]) {
      const text = clean(document.body.textContent);
      const headingText = clean(
        Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
          .map((heading) => heading.textContent)
          .join(" "),
      );

      expect(text).not.toContain("40+");
      expect(text).not.toContain("Most common");
      expect(text).not.toContain("May 2026");
      expect(headingText).not.toMatch(/testimonial|client results?|case stud(?:y|ies)/i);
      expect(document.querySelector("blockquote")).toBeNull();
      expect(
        document.querySelector(
          "[class*='testimonial'], [class*='case-study'], [data-testimonial]",
        ),
      ).toBeNull();
    }
  });

  it("keeps only the atmospheric hero video on home and no Services video", () => {
    const homeVideos = Array.from(
      home.querySelectorAll("video"),
      (video) => video.getAttribute("src"),
    );

    expect(homeVideos).toEqual(["/videos/hero.mp4"]);
    expect(services.querySelectorAll("video")).toHaveLength(0);
  });
});
