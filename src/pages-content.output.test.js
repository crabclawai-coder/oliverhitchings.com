import { JSDOM } from "jsdom";
import { spawn } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = new URL("../", import.meta.url);
const guidePriceNote =
  "Guide prices. VAT, third-party software, model usage and hosting are separate where they apply.";
const turnstileTestSiteKey = "1x00000000000000000000AA";
const turnstileTestSecret = "1x0000000000000000000000000000000AA";
const expectedHeroSources = [
  {
    dataSrc: "/videos/hero-960.webm",
    media: "(max-width: 640px)",
    type: 'video/webm; codecs="av01.0.04M.08"',
  },
  {
    dataSrc: "/videos/hero-960.mp4",
    media: "(max-width: 640px)",
    type: 'video/mp4; codecs="avc1.64001f"',
  },
  {
    dataSrc: "/videos/hero-1280.webm",
    media: null,
    type: 'video/webm; codecs="av01.0.05M.08"',
  },
  {
    dataSrc: "/videos/hero-1280.mp4",
    media: null,
    type: 'video/mp4; codecs="avc1.640028"',
  },
];
const rawLegacyVideoNames = [
  "hero.mp4",
  "process.mp4",
  "feature-card.mp4",
  "cta-footer.mp4",
  "bento.mp4",
];

let buildDirectory;
let observeBuildDirectory;
let temporaryDirectory;
let home;
let services;
let servicesHtml;
let observeServices;
let about;
let blog;
let articlePages;
let notFound;
let servicesModuleSources;
let homeModuleSources;
let observeServicesModuleSources;
let observeGeneratedFiles;
let servicesStylesheetSource;

const expectedPosts = [
  {
    slug: "what-a-good-first-build-proves",
    title: "What a first automation project should prove",
    date: "2026-05-19",
    category: "Project design",
  },
  {
    slug: "local-first-is-an-operating-choice",
    title: "Local-first is an operating choice",
    date: "2026-05-18",
    category: "Infrastructure",
  },
  {
    slug: "automation-is-an-operations-project",
    title: "Automation is an operations project",
    date: "2026-05-17",
    category: "Field note",
  },
];

const clean = (value) => value?.replace(/\s+/g, " ").trim() ?? "";

function textFragments(root) {
  const fragments = [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    root.ownerDocument.defaultView.NodeFilter.SHOW_TEXT,
  );

  while (walker.nextNode()) {
    const value = clean(walker.currentNode.textContent);

    if (value) {
      fragments.push(value);
    }
  }

  return fragments;
}

async function readPage(filePath, directory = buildDirectory) {
  const html = await readFile(join(directory, filePath), "utf8");
  return new JSDOM(html).window.document;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readModuleSources(documentRef, directory) {
  return Promise.all(
    Array.from(
      documentRef.querySelectorAll("script[type='module'][src]"),
      (script) =>
        readFile(
          join(directory, script.getAttribute("src").replace(/^\//, "")),
          "utf8",
        ),
    ),
  );
}

async function readGeneratedFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const filePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return readGeneratedFiles(filePath);
      }

      return [{ filePath, contents: await readFile(filePath) }];
    }),
  );

  return nestedFiles.flat();
}

function buildEnvironment(overrides = {}) {
  const environment = { ...process.env };
  delete environment.PUBLIC_TURNSTILE_MODE;
  delete environment.PUBLIC_TURNSTILE_SITE_KEY;
  delete environment.TURNSTILE_SECRET_KEY;

  return { ...environment, ...overrides };
}

function buildInIsolatedProcess({ cwd, env, outDir, root }) {
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
        env,
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
  observeBuildDirectory = join(temporaryDirectory, "dist-observe");
  await symlink(
    join(fileURLToPath(projectRoot), "node_modules"),
    join(temporaryDirectory, "node_modules"),
  );

  await buildInIsolatedProcess({
    cwd: temporaryDirectory,
    env: buildEnvironment(),
    outDir: buildDirectory,
    root: fileURLToPath(projectRoot),
  });
  await buildInIsolatedProcess({
    cwd: temporaryDirectory,
    env: buildEnvironment({
      PUBLIC_TURNSTILE_MODE: "observe",
      PUBLIC_TURNSTILE_SITE_KEY: turnstileTestSiteKey,
      TURNSTILE_SECRET_KEY: turnstileTestSecret,
    }),
    outDir: observeBuildDirectory,
    root: fileURLToPath(projectRoot),
  });

  home = await readPage("index.html");
  services = await readPage("services/index.html");
  servicesHtml = await readFile(join(buildDirectory, "services/index.html"), "utf8");
  observeServices = await readPage(
    "services/index.html",
    observeBuildDirectory,
  );
  about = await readPage("about/index.html");
  blog = await readPage("blog/index.html");
  articlePages = await Promise.all(
    expectedPosts.map(async (post) => ({
      ...post,
      document: await readPage(`blog/${post.slug}/index.html`),
    })),
  );
  notFound = await readPage("404.html");
  servicesModuleSources = await readModuleSources(services, buildDirectory);
  homeModuleSources = await readModuleSources(home, buildDirectory);
  observeServicesModuleSources = await readModuleSources(
    observeServices,
    observeBuildDirectory,
  );
  observeGeneratedFiles = await readGeneratedFiles(observeBuildDirectory);
  const stylesheetPath = services
    .querySelector("link[rel='stylesheet']")
    ?.getAttribute("href");
  servicesStylesheetSource = await readFile(
    join(buildDirectory, stylesheetPath.replace(/^\//, "")),
    "utf8",
  );
}, 120_000);

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
      "1 workflow Selected before a build begins.",
    );
    expect(clean(proofItems[0]?.querySelector(".proof-value")?.textContent)).toBe(
      "1 workflow",
    );
    expect(clean(proofItems[1]?.textContent)).toBe(
      "3 handover assets Prompts, logs and a runbook stay with the owner.",
    );
    expect(clean(proofItems[1]?.querySelector(".proof-value")?.textContent)).toBe(
      "3 handover assets",
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
    const packageRows = Array.from(packages?.querySelectorAll(".package-row") ?? []);
    const principles = home.querySelector("[data-operating-principles]");
    const finalCta = home.querySelector(".home-final-cta");

    expect(clean(packages?.querySelector("h2")?.textContent)).toBe(
      "Choose the smallest useful first step.",
    );
    expect(packageText).toContain("Fixed scope Task Map £250");
    expect(packageText).toContain("Focused implementation First Build £500");
    expect(packageText).toContain("Connected workflow Operator System £1,000");
    expect(packageText).toContain("Optional retainer Ongoing support from £100/month");
    expect(packageText).toContain(guidePriceNote);
    expect(
      packageRows.map((row) => ({
        headings: row.querySelectorAll("h3").length,
        label: clean(row.querySelector("h3")?.textContent),
        action: clean(row.querySelector("a")?.textContent),
      })),
    ).toEqual([
      { headings: 1, label: "Task Map", action: "Enquire about Task Map" },
      { headings: 1, label: "First Build", action: "Enquire about First Build" },
      {
        headings: 1,
        label: "Operator System",
        action: "Enquire about Operator System",
      },
      {
        headings: 1,
        label: "Ongoing support",
        action: "Enquire about ongoing support",
      },
    ]);
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
    const packageRows = Array.from(
      packages?.querySelectorAll(".services-package-row") ?? [],
    );

    expect(text).toContain("Fixed scope Task Map £250");
    expect(text).toContain("Focused implementation First Build £500");
    expect(text).toContain("Connected workflow Operator System £1,000");
    expect(text).toContain("Run guide plus two review sessions after first use");
    expect(text).toContain("30-day improvement period after launch");
    expect(text).toContain("Optional retainer Ongoing support from £100/month");
    expect(text).toContain(guidePriceNote);
    expect(
      packageRows.map((row) => ({
        headings: row.querySelectorAll("h3").length,
        label: clean(row.querySelector("h3")?.textContent),
        action: clean(row.querySelector("a")?.textContent),
      })),
    ).toEqual([
      { headings: 1, label: "Task Map", action: "Enquire about Task Map" },
      { headings: 1, label: "First Build", action: "Enquire about First Build" },
      {
        headings: 1,
        label: "Operator System",
        action: "Enquire about Operator System",
      },
      {
        headings: 1,
        label: "Ongoing support",
        action: "Enquire about ongoing support",
      },
    ]);
  });

  it("ships only styling that the text-only method trace uses", () => {
    expect(services.querySelector(".method-trace span")).toBeNull();
    expect(servicesStylesheetSource).not.toContain(".method-trace span");
    expect(servicesStylesheetSource).not.toMatch(
      /\.method-trace\{[^}]*\b(?:gap|flex-wrap):/,
    );
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

  it("restores exactly two nearby looping films in the intended chapters", () => {
    const films = Array.from(services.querySelectorAll("[data-motion-film]"));
    const videos = films.map((film) => film.querySelector("video"));

    expect(films.map((film) => film.getAttribute("data-motion-film"))).toEqual([
      "process",
      "feature-card",
    ]);
    expect(
      services.querySelector(
        ".services-method__body > .services-method__film[data-motion-film='process']",
      ),
    ).not.toBeNull();
    expect(
      services.querySelector(
        ".handover-section__grid > .handover-section__film[data-motion-film='feature-card']",
      ),
    ).not.toBeNull();
    expect(
      films.map((film) => ({
        hidden: film.getAttribute("aria-hidden"),
        hasCaption: film.querySelector("figcaption") !== null,
      })),
    ).toEqual([
      { hidden: "true", hasCaption: false },
      { hidden: "true", hasCaption: false },
    ]);
    expect(videos.every((video) => video?.getAttribute("data-media-load") === "nearby"))
      .toBe(true);
    expect(videos.every((video) => video?.getAttribute("data-media-behaviour") === "loop"))
      .toBe(true);
    expect(services.querySelectorAll("[data-scroll-film]")).toHaveLength(0);
    expect(services.querySelector("#contact [data-motion-film]")).toBeNull();
  });

  it("compacts only the four middle Services chapters", () => {
    const method = services.querySelector("[data-services-method]");
    const packages = services.getElementById("packages");
    const goodFit = services.querySelector("[data-good-fit]");
    const handover = services.querySelector("[data-handover]");
    const contact = services.getElementById("contact");

    expect(
      [method, packages, goodFit, handover].every((section) =>
        section?.classList.contains("editorial-section--compact"),
      ),
    ).toBe(true);
    expect(services.querySelectorAll(".editorial-section--compact")).toHaveLength(4);
    expect(contact?.classList.contains("editorial-section--compact")).toBe(false);
    expect(servicesStylesheetSource).toMatch(
      /--editorial-section-space:\s*clamp\(5rem,\s*9vw,\s*8rem\)/,
    );
    expect(servicesStylesheetSource).toMatch(
      /--editorial-section-space-compact:\s*clamp\(4\.25rem,\s*7\.65vw,\s*6\.8rem\)/,
    );
    expect(servicesStylesheetSource).toMatch(
      /\.editorial-section\{[^}]*padding-top:var\(--editorial-section-space\);[^}]*padding-bottom:var\(--editorial-section-space\)/,
    );
    expect(servicesStylesheetSource).toMatch(
      /\.editorial-section--compact\{[^}]*padding-top:var\(--editorial-section-space-compact\);[^}]*padding-bottom:var\(--editorial-section-space-compact\)/,
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
    expect(
      form?.querySelector(
        "input[name='_honey'][type='text'][tabindex='-1'][autocomplete='off'][aria-hidden='true']",
      ),
    ).not.toBeNull();
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
    expect(
      form?.querySelector("button.button[type='submit']")?.textContent.trim(),
    ).toBe("Send enquiry");
    expect(
      servicesModuleSources.some(
        (source) =>
          source.includes("[data-contact-form]") &&
          source.includes('addEventListener("submit"') &&
          /[A-Za-z_$][\w$]*\(\);?\s*$/.test(source),
      ),
    ).toBe(true);
  });

  it("keeps rendered package values aligned with the Worker allowlist", async () => {
    const form = services.querySelector("form[data-contact-form]");
    const renderedValues = Array.from(
      form?.querySelectorAll(
        "select[name='package_interest'] option:not([value=''])",
      ) ?? [],
      (option) => option.value,
    );
    const workerModule = await import("../contact-worker/src/index.js");

    expect(workerModule.ALLOWED_PACKAGES).toBeInstanceOf(Set);
    expect([...workerModule.ALLOWED_PACKAGES]).toEqual(renderedValues);
  });

  it("defaults to an inert off-mode container without a Turnstile network reference", () => {
    const form = services.querySelector("form[data-contact-form]");
    const container = form?.querySelector(
      "[data-turnstile-container][role='group'][aria-label='Security check'][aria-describedby='contact-form-status'][tabindex='-1']",
    );

    expect(form?.getAttribute("data-turnstile-mode")).toBe("off");
    expect(form?.getAttribute("data-turnstile-site-key")).toBe("");
    expect(container).not.toBeNull();
    expect(container?.hasAttribute("hidden")).toBe(true);
    expect(servicesHtml).not.toContain("challenges.cloudflare.com");
    expect(servicesModuleSources.join("\n")).not.toContain(
      "challenges.cloudflare.com",
    );
  });

  it("ships a visible outline for programmatically focused fallback checks", () => {
    expect(servicesStylesheetSource).toMatch(
      /\.turnstile-check:focus\{[^}]*outline:/,
    );
  });

  it("emits observe configuration and a same-origin external initializer", () => {
    const form = observeServices.querySelector("form[data-contact-form]");
    const container = form?.querySelector(
      "[data-turnstile-container][role='group'][aria-label='Security check'][aria-describedby='contact-form-status'][tabindex='-1']",
    );
    const externalModules = Array.from(
      observeServices.querySelectorAll("script[type='module'][src]"),
    );

    expect(form?.getAttribute("action")).toBe("/api/contact");
    expect(form?.getAttribute("data-turnstile-mode")).toBe("observe");
    expect(form?.getAttribute("data-turnstile-site-key")).toBe(
      turnstileTestSiteKey,
    );
    expect(container).not.toBeNull();
    expect(container?.hasAttribute("hidden")).toBe(false);
    expect(externalModules.length).toBeGreaterThan(0);
    expect(
      externalModules.every((script) =>
        script.getAttribute("src")?.startsWith("/"),
      ),
    ).toBe(true);
    expect(
      observeServices.querySelector("script[type='module']:not([src])"),
    ).toBeNull();
    expect(observeServicesModuleSources.join("\n")).toContain("turnstile");
  });

  it("recursively scans every observe-build file for private Turnstile data", () => {
    expect(
      observeGeneratedFiles.some(
        ({ filePath, contents }) =>
          /[/\\]_astro[/\\]turnstile\.[^/\\]+\.js$/.test(filePath) &&
          contents.includes("challenges.cloudflare.com"),
      ),
    ).toBe(true);
    expect(
      observeGeneratedFiles.filter(({ contents }) =>
        contents.includes("TURNSTILE_SECRET_KEY"),
      ),
    ).toEqual([]);
    expect(
      observeGeneratedFiles.filter(({ contents }) =>
        contents.includes(turnstileTestSecret),
      ),
    ).toEqual([]);
  });
});

describe("generated page truthfulness and media", () => {
  it("removes stale or unverified framing from both pages", () => {
    const approvedClientMentions = [
      "Accepting 1 client",
      "These are example system patterns, not client case studies.",
    ];
    const approvedNarrativeClaims = [
      "Accepting 1 client",
      "1 workflow",
      "30-day improvement period after launch",
    ];
    const claimSignal =
      /(?:\b\d+\+(?!\w)|\b\d+(?:\.\d+)?%(?!\w)|\b\d+\s+(?:clients?|customers?|projects?|automations?|workflows?|hours?|days?|weeks?|years?)\b|\b\d+-(?:day|week|year)\b|\b(?:certified|accredited|award-winning|credentials?)\b)/i;

    for (const document of [home, services]) {
      const text = clean(document.body.textContent);
      const clientMentions = textFragments(document.querySelector("main")).filter(
        (value) => /\bclients?\b/i.test(value),
      );
      const narrative = document.querySelector("main")?.cloneNode(true);

      narrative?.querySelector(".pattern-disclosure")?.remove();
      const narrativeText = clean(narrative?.textContent);
      const claimBearingFragments = textFragments(narrative).filter((value) =>
        claimSignal.test(value),
      );

      expect(text).not.toContain("40+");
      expect(text).not.toContain("Most common");
      expect(text).not.toContain("May 2026");
      expect(narrativeText).not.toMatch(
        /\b(?:testimonial|client results?|client outcomes?|client case stud(?:y|ies)|customer results?|customer outcomes?|case stud(?:y|ies)|certified|accredited|award-winning|credentials?)\b/i,
      );
      expect(narrativeText).not.toMatch(
        /\b(?:saved?|cut|reduced?|increased?|boosted?|grew)\b.{0,60}\b(?:hours?|days?|weeks?|percent|revenue|costs?|time)\b/i,
      );
      expect(narrativeText).not.toMatch(
        /(?:\b\d+(?:\.\d+)?%(?!\w)|\b\d+\+(?!\w))/,
      );
      expect(clientMentions).toEqual(
        approvedClientMentions.filter((mention) => text.includes(mention)),
      );
      expect(claimBearingFragments).toEqual(
        approvedNarrativeClaims.filter((claim) => narrativeText.includes(claim)),
      );
      expect(document.querySelector("blockquote")).toBeNull();
      expect(
        document.querySelector(
          "[class*='testimonial'], [class*='case-study'], [data-testimonial]",
        ),
      ).toBeNull();
    }
  });

  it("restores the five homepage films in their exact narrative placements", () => {
    const filmIds = Array.from(
      home.querySelectorAll("[data-motion-film]"),
      (film) => film.getAttribute("data-motion-film"),
    );

    expect(filmIds).toEqual([
      "hero",
      "process",
      "bento",
      "feature-card",
      "cta-footer",
    ]);
    expect(
      home.querySelector(
        ".loop-section__film-region > .loop-section__film[data-motion-film='process']",
      ),
    ).not.toBeNull();
    expect(
      home.querySelector(
        ".pattern-aside > .pattern-section__film[data-motion-film='bento']",
      ),
    ).not.toBeNull();
    expect(
      home.querySelector(
        ".principles-section__body > .principles-section__film[data-motion-film='feature-card']",
      ),
    ).not.toBeNull();
    expect(
      home.querySelector(
        ".home-final-cta > .home-final-cta__film[data-motion-film='cta-footer']",
      ),
    ).not.toBeNull();
    expect(home.querySelector("#contact [data-motion-film]")).toBeNull();
  });

  it("hides captionless homepage film wrappers from assistive technology", () => {
    const films = Array.from(home.querySelectorAll("[data-motion-film]"));

    expect(films).toHaveLength(5);
    expect(
      films.map((film) => ({
        hidden: film.getAttribute("aria-hidden"),
        tagName: film.tagName,
        hasCaption: film.querySelector("figcaption") !== null,
      })),
    ).toEqual(
      Array.from({ length: 5 }, () => ({
        hidden: "true",
        tagName: "FIGURE",
        hasCaption: false,
      })),
    );
  });

  it("keeps scroll behaviour exclusive to the homepage process film", () => {
    const scrollFilms = Array.from(home.querySelectorAll("[data-scroll-film]"));
    const processFilm = home.querySelector('[data-motion-film="process"]');
    const ambientFilms = Array.from(
      home.querySelectorAll(
        '[data-motion-film]:not([data-motion-film="process"]) video',
      ),
    );

    expect(scrollFilms).toHaveLength(1);
    expect(scrollFilms[0]?.closest("[data-motion-film]")).toBe(processFilm);
    expect(scrollFilms[0]?.getAttribute("data-media-behaviour")).toBe("scroll");
    expect(processFilm?.closest("[data-scroll-film-region]")).not.toBeNull();
    expect(ambientFilms).toHaveLength(4);
    expect(
      ambientFilms.every(
        (video) =>
          video.getAttribute("data-media-behaviour") === "loop" &&
          !video.hasAttribute("data-scroll-film"),
      ),
    ).toBe(true);
  });

  it("uses the approved film count on every route and keeps articles and 404 static", () => {
    expect(home.querySelectorAll("video")).toHaveLength(5);
    expect(services.querySelectorAll("video")).toHaveLength(2);
    expect(about.querySelectorAll("video")).toHaveLength(1);
    expect(blog.querySelectorAll("video")).toHaveLength(1);

    for (const document of [
      ...articlePages.map((post) => post.document),
      notFound,
    ]) {
      expect(document.querySelectorAll("[data-motion-film]")).toHaveLength(0);
      expect(document.querySelectorAll("video")).toHaveLength(0);
    }
  });

  it("renders the eager hero poster and deferred decorative-media semantics", () => {
    const film = home.querySelector('[data-motion-film="hero"]');
    const poster = film?.querySelector(".motion-film__poster");
    const video = film?.querySelector(".home-hero__video");

    expect(film?.classList.contains("home-hero__media")).toBe(true);
    expect(poster?.getAttribute("src")).toBe("/images/posters/hero.webp");
    expect(poster?.getAttribute("width")).toBe("1280");
    expect(poster?.getAttribute("height")).toBe("720");
    expect(poster?.getAttribute("loading")).toBe("eager");
    expect(poster?.getAttribute("fetchpriority")).toBe("high");
    expect(poster?.getAttribute("alt")).toBe("");
    expect(poster?.getAttribute("aria-hidden")).toBe("true");
    expect(video?.getAttribute("preload")).toBe("none");
    expect(video?.hasAttribute("poster")).toBe(false);
    expect(video?.hasAttribute("autoplay")).toBe(false);
    expect(video?.hasAttribute("src")).toBe(false);
    expect(video?.hasAttribute("muted")).toBe(true);
    expect(video?.hasAttribute("loop")).toBe(true);
    expect(video?.hasAttribute("playsinline")).toBe(true);
    expect(video?.getAttribute("aria-hidden")).toBe("true");
    expect(video?.getAttribute("tabindex")).toBe("-1");
    expect(video?.hasAttribute("data-media")).toBe(true);
    expect(video?.getAttribute("data-media-load")).toBe("eager");
    expect(video?.getAttribute("data-media-behaviour")).toBe("loop");
  });

  it("emits four unique same-origin deferred sources in responsive order", async () => {
    const sources = Array.from(
      home.querySelectorAll(".home-hero__video source"),
      (source) => ({
        dataSrc: source.getAttribute("data-src"),
        media: source.getAttribute("media"),
        type: source.getAttribute("type"),
      }),
    );

    expect(sources).toEqual(expectedHeroSources);
    expect(new Set(sources.map(({ dataSrc }) => dataSrc)).size).toBe(4);
    expect(
      sources.every(
        ({ dataSrc }) => dataSrc?.startsWith("/") && !dataSrc.startsWith("//"),
      ),
    ).toBe(true);
    expect(
      home.querySelectorAll(".home-hero__video source[src]"),
    ).toHaveLength(0);
    expect(
      await Promise.all(
        expectedHeroSources.map(({ dataSrc }) =>
          fileExists(join(buildDirectory, dataSrc.slice(1))),
        ),
      ),
    ).toEqual([true, true, true, true]);
    expect(
      await fileExists(join(buildDirectory, "images/posters/hero.webp")),
    ).toBe(true);
  });

  it("removes obsolete video references and governs future below-fold media", () => {
    const contentPages = [
      home,
      services,
      about,
      blog,
      ...articlePages.map((post) => post.document),
    ];
    const generatedMarkup = contentPages
      .map((document) => document.documentElement.outerHTML)
      .join("\n");
    const belowFoldVideos = contentPages.flatMap((document) =>
      Array.from(document.querySelectorAll("video:not(.home-hero__video)")),
    );

    for (const rawLegacyName of rawLegacyVideoNames) {
      expect(generatedMarkup).not.toContain(`/videos/${rawLegacyName}`);
    }
    for (const video of belowFoldVideos) {
      expect(
        video
          .closest("[data-motion-film]")
          ?.querySelector(".motion-film__poster")
          ?.getAttribute("src"),
      ).toMatch(/^\/images\/posters\/.+\.webp$/);
      expect(video.getAttribute("preload")).toBe("none");
      expect(video.getAttribute("data-media-load")).toBe("nearby");
      expect(video.hasAttribute("autoplay")).toBe(false);
      expect(video.hasAttribute("src")).toBe(false);
    }
  });

  it("keeps the media initializer in same-origin external modules", () => {
    const externalModules = Array.from(
      home.querySelectorAll("script[type='module'][src]"),
    );

    expect(externalModules.length).toBeGreaterThan(0);
    expect(
      externalModules.every((script) => script.getAttribute("src")?.startsWith("/")),
    ).toBe(true);
    expect(home.querySelector("script[type='module']:not([src])")).toBeNull();
    expect(homeModuleSources.join("\n")).toContain("video[data-media]");
    expect(homeModuleSources.join("\n")).toContain("320px 0px");
  });
});

describe("generated About content", () => {
  it("pairs Oliver's factual working focus with the approved feature-card film", () => {
    const hero = about.querySelector("[data-about-hero]");
    const film = hero?.querySelector(
      ".about-hero__visual > .about-hero__film[data-motion-film='feature-card']",
    );
    const video = film?.querySelector("video");
    const identity = hero?.querySelector("[data-about-identity]");
    const sources = Array.from(film?.querySelectorAll("source") ?? []);

    expect(about.querySelectorAll("h1")).toHaveLength(1);
    expect(clean(hero?.querySelector(".eyebrow")?.textContent)).toBe(
      "About Oliver Hitchings",
    );
    expect(clean(hero?.querySelector("h1")?.textContent)).toBe(
      "I design small automation systems around the work people already do.",
    );
    expect(clean(hero?.querySelector(".about-hero__intro")?.textContent)).toBe(
      "My approach starts with the task: what triggers it, which evidence it uses, where judgement is needed and who owns the result.",
    );
    expect(clean(identity?.textContent)).toBe(
      "Oliver Hitchings Automation systems Map → Build → Hand over",
    );
    expect(film?.tagName).toBe("FIGURE");
    expect(film?.getAttribute("aria-hidden")).toBeNull();
    expect(
      film?.querySelector(".motion-film__caption > .about-identity"),
    ).toBe(identity);
    expect(video?.getAttribute("aria-hidden")).toBe("true");
    expect(video?.getAttribute("data-media-load")).toBe("nearby");
    expect(video?.getAttribute("data-media-behaviour")).toBe("loop");
    expect(video?.hasAttribute("data-scroll-film")).toBe(false);
    expect(sources).toHaveLength(4);
    expect(
      sources.every(
        (source) =>
          source.hasAttribute("data-src") && !source.hasAttribute("src"),
      ),
    ).toBe(true);
    expect(about.querySelectorAll("[data-motion-film]")).toHaveLength(1);
    expect(about.querySelectorAll("[data-scroll-film]")).toHaveLength(0);
  });

  it("uses the approved operating stance and four editorial principles", () => {
    const stance = about.querySelector("[data-operating-stance]");
    const principles = Array.from(
      about.querySelectorAll("[data-about-principles] article"),
      (row) => ({
        title: clean(row.querySelector("h3")?.textContent),
        copy: clean(row.querySelector("p")?.textContent),
      }),
    );

    expect(clean(stance?.querySelector("h2")?.textContent)).toBe(
      "The model call is only one step.",
    );
    expect(clean(stance?.querySelector(".about-stance__copy")?.textContent)).toBe(
      "The operational questions come first: which source of truth wins, when the system should stop, what gets logged and what a person should do when confidence is low. Once those boundaries are clear, the build can stay narrow, observable and easier to hand over.",
    );
    expect(principles).toEqual([
      {
        title: "Show the work",
        copy: "Prompts, rules, assumptions and logs visible enough to review a bad run.",
      },
      {
        title: "Keep a person responsible",
        copy: "Stop for review when a step is uncertain or consequential.",
      },
      {
        title: "Design the failure path",
        copy: "Make retries, stop conditions and escalation explicit.",
      },
      {
        title: "Hand over ownership",
        copy: "Leave run instructions, logs and change notes with the owner.",
      },
    ]);
  });

  it("ends with the approved package and on-site enquiry actions", () => {
    const cta = about.querySelector("[data-about-cta]");

    expect(clean(cta?.querySelector("h2")?.textContent)).toBe(
      "Bring one task that already repeats.",
    );
    expect(clean(cta?.querySelector(".about-cta__copy")?.textContent)).toBe(
      "Describe the trigger, inputs, output, tools and reviewer. That is enough to decide whether a Task Map, First Build or Operator System is the sensible starting point.",
    );
    expect(clean(cta?.querySelector("a[href='/services#packages']")?.textContent)).toBe(
      "View packages",
    );
    expect(clean(cta?.querySelector("a[href='/services#contact']")?.textContent)).toBe(
      "Start an enquiry",
    );
  });
});

describe("generated Field Notes landing", () => {
  it("introduces the field notes with one contained cta-footer film", () => {
    const hero = blog.querySelector("[data-blog-hero]");
    const grid = hero?.querySelector(".blog-hero__grid");
    const copy = hero?.querySelector(".blog-hero__grid > .blog-hero__copy");
    const film = hero?.querySelector(
      ".blog-hero__grid > .blog-hero__film[data-motion-film='cta-footer']",
    );
    const video = film?.querySelector("video");
    const sources = Array.from(film?.querySelectorAll("source") ?? []);

    expect(blog.querySelectorAll("h1")).toHaveLength(1);
    expect(grid).not.toBeNull();
    expect(clean(copy?.querySelector(".eyebrow")?.textContent)).toBe("Field notes");
    expect(clean(copy?.querySelector("h1")?.textContent)).toBe(
      "Automation that has to operate, not just demo.",
    );
    expect(clean(copy?.querySelector(".blog-hero__intro")?.textContent)).toBe(
      "Short writing on task design, human review, logs, failure handling and handover.",
    );
    expect(film?.tagName).toBe("FIGURE");
    expect(film?.getAttribute("aria-hidden")).toBe("true");
    expect(film?.querySelector("figcaption")).toBeNull();
    expect(video?.getAttribute("aria-hidden")).toBe("true");
    expect(video?.getAttribute("data-media-load")).toBe("nearby");
    expect(video?.getAttribute("data-media-behaviour")).toBe("loop");
    expect(video?.hasAttribute("data-scroll-film")).toBe(false);
    expect(sources).toHaveLength(4);
    expect(
      sources.every(
        (source) =>
          source.hasAttribute("data-src") && !source.hasAttribute("src"),
      ),
    ).toBe(true);
    expect(blog.querySelectorAll("[data-motion-film]")).toHaveLength(1);
    expect(blog.querySelectorAll("[data-scroll-film]")).toHaveLength(0);
  });

  it("keeps every existing note as a ruled row with category, date and two links", () => {
    const rows = Array.from(blog.querySelectorAll("[data-note-row]"));

    expect(rows).toHaveLength(expectedPosts.length);
    expect(
      rows.map((row) => ({
        category: clean(row.querySelector("[data-note-category]")?.textContent),
        date: row.querySelector("time")?.getAttribute("datetime"),
        title: clean(row.querySelector("h2")?.textContent),
        titleHref: row.querySelector("h2 a")?.getAttribute("href"),
        readHref: row.querySelector(".text-link")?.getAttribute("href"),
        readLabel: clean(row.querySelector(".text-link")?.textContent),
        readAccessibleLabel: row.querySelector(".text-link")?.getAttribute("aria-label"),
        hasSummary: Boolean(clean(row.querySelector("[data-note-summary]")?.textContent)),
      })),
    ).toEqual(
      expectedPosts.map((post) => ({
        category: post.category,
        date: post.date,
        title: post.title,
        titleHref: `/blog/${post.slug}`,
        readHref: `/blog/${post.slug}`,
        readLabel: "Read note",
        readAccessibleLabel: `Read note: ${post.title}`,
        hasSummary: true,
      })),
    );
  });
});

describe("generated Field Note articles", () => {
  it("keeps one H1, each existing title and date, and useful breadcrumb semantics", () => {
    for (const post of articlePages) {
      const breadcrumb = post.document.querySelector("nav[aria-label='Breadcrumb']");
      const time = post.document.querySelector("article time");

      expect(post.document.querySelectorAll("h1")).toHaveLength(1);
      expect(clean(post.document.querySelector("h1")?.textContent)).toBe(post.title);
      expect(time?.getAttribute("datetime")).toBe(post.date);
      expect(clean(breadcrumb?.querySelector("a[href='/blog']")?.textContent)).toBe(
        "Field notes",
      );
      expect(
        Array.from(breadcrumb?.querySelectorAll("li") ?? [], (item) =>
          clean(item.textContent),
        ),
      ).toEqual(["Field notes", post.category, post.title]);
      expect(breadcrumb?.querySelectorAll("[aria-current='page']")).toHaveLength(1);
      expect(clean(breadcrumb?.querySelector("[aria-current='page']")?.textContent)).toBe(
        post.title,
      );
    }
  });

  it("ends every note with package and on-site enquiry actions", () => {
    for (const post of articlePages) {
      const cta = post.document.querySelector("[data-article-cta]");

      expect(clean(cta?.querySelector("h2")?.textContent)).toBe(
        "Working on a repeat task?",
      );
      expect(clean(cta?.querySelector("p")?.textContent)).toBe(
        "See the packages or send the task through the on-site enquiry form.",
      );
      expect(clean(cta?.querySelector("a[href='/services#packages']")?.textContent)).toBe(
        "View packages",
      );
      expect(clean(cta?.querySelector("a[href='/services#contact']")?.textContent)).toBe(
        "Start an enquiry",
      );
    }
  });

  it("uses only the two approved factual-safety corrections", () => {
    const articleText = articlePages
      .map((post) => clean(post.document.querySelector(".article-body")?.textContent))
      .join(" ");

    expect(articleText).not.toContain(
      "The early win is usually not glamour. It is one recurring job that stops taking attention every week.",
    );
    expect(articleText).toContain(
      "The useful test is more modest: can one recurring job have clear inputs, visible review points and a repeatable path?",
    );
    expect(articleText).not.toContain(
      "That approach is slower to sell than a black-box SaaS dashboard, but it is easier to operate.",
    );
    expect(articleText).toContain(
      "The trade-off is explicit ownership: the team needs to know where the system runs and how it is maintained.",
    );
  });
});

describe("supporting-page truthfulness and contact paths", () => {
  it("introduces no mail action or invented proof language", () => {
    for (const document of [
      about,
      blog,
      ...articlePages.map((post) => post.document),
    ]) {
      const mainText = clean(document.querySelector("main")?.textContent);

      expect(Boolean(document.querySelector("main a[href^='mailto:']"))).toBe(false);
      expect(mainText).not.toMatch(
        /\b(?:testimonial|client results?|client outcomes?|client case stud(?:y|ies)|customer results?|customer outcomes?|award-winning|certified|accredited)\b/i,
      );
    }
  });
});
