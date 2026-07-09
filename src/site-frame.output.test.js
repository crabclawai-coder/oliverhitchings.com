import { build } from "astro";
import { JSDOM } from "jsdom";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = new URL("../", import.meta.url);
const redirectPages = new Set(["now/index.html", "pilot/index.html"]);

let buildDirectory;
let temporaryDirectory;
let outputFiles;
let contentPages;

async function listFiles(directory, currentDirectory = directory) {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, entryPath)));
    } else {
      files.push(relative(directory, entryPath).split(sep).join("/"));
    }
  }

  return files;
}

async function readOutput(filePath) {
  return readFile(join(buildDirectory, filePath), "utf8");
}

async function readPage(filePath) {
  return new JSDOM(await readOutput(filePath)).window.document;
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "oliverhitchings-site-frame-"));
  buildDirectory = join(temporaryDirectory, "dist");

  await build({
    root: fileURLToPath(projectRoot),
    outDir: buildDirectory,
    logLevel: "silent",
  });

  outputFiles = await listFiles(buildDirectory);
  contentPages = outputFiles
    .filter((filePath) => filePath.endsWith(".html"))
    .filter((filePath) => !redirectPages.has(filePath));
}, 60_000);

afterAll(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("generated site frame", () => {
  it("shows Oliver Hitchings as the primary home brand", async () => {
    const document = await readPage("index.html");
    const brand = document.querySelector(".site-header .brand-mark[href='/']");

    expect(brand).not.toBeNull();
    expect(brand.textContent.replace(/\s+/g, " ").trim()).toContain(
      "Oliver Hitchings",
    );
    expect(brand.getAttribute("aria-label")).toMatch(/Oliver Hitchings.*home/i);
  });

  it("lays out the header brand as a horizontal 44px lockup", async () => {
    const document = await readPage("index.html");
    const brand = document.querySelector(
      ".site-header .brand-mark.brand-lockup[href='/']",
    );
    const bundledCss = (
      await Promise.all(
        outputFiles
          .filter((filePath) => filePath.endsWith(".css"))
          .map(readOutput),
      )
    ).join("\n");
    const lockupRule = bundledCss.match(
      /\.brand-lockup(?:\[[^\]]+\])?\{([^}]*)\}/,
    )?.[1];

    expect(brand).not.toBeNull();
    expect(brand.querySelector("svg")).not.toBeNull();
    expect(brand.querySelector(".brand-name")?.textContent.trim()).toBe(
      "Oliver Hitchings",
    );
    expect(lockupRule).toContain("display:inline-flex");
    expect(lockupRule).toContain("flex-direction:row");
    expect(lockupRule).toContain("align-items:center");
    expect(lockupRule).toContain("gap:10px");
    expect(lockupRule).toContain("width:auto");
    expect(lockupRule).toContain("min-height:44px");
    expect(lockupRule).toContain("height:auto");
    expect(lockupRule).toContain("padding:0 10px");
    expect(lockupRule).toContain("white-space:nowrap");
  });

  it("places a keyboard-focusable skip target around the page content", async () => {
    const document = await readPage("index.html");
    const skipLink = document.querySelector("body > a[href='#main-content']");
    const header = document.querySelector("body > header");
    const target = document.getElementById("main-content");

    expect(skipLink).not.toBeNull();
    expect(skipLink.textContent).toMatch(/skip to main content/i);
    expect(
      skipLink.compareDocumentPosition(header) &
        document.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(target).not.toBeNull();
    expect(target.getAttribute("tabindex")).toBe("-1");
    expect(target.tagName).not.toBe("MAIN");
    expect(target.querySelector("main")).not.toBeNull();
  });

  it("uses the on-site enquiry path for primary frame contact actions", async () => {
    const document = await readPage("index.html");
    const headerAction = document.querySelector(".site-header .nav-cta");
    const footerAction = document.querySelector(
      ".site-footer .footer-links > div:last-child a[href='/services#contact']",
    );
    const frameEmailLinks = document.querySelectorAll(
      ".site-header a[href^='mailto:'], .site-footer a[href^='mailto:']",
    );

    expect(headerAction?.getAttribute("href")).toBe("/services#contact");
    expect(headerAction?.textContent.trim()).toBe("Start an enquiry");
    expect(footerAction).not.toBeNull();
    expect(frameEmailLinks).toHaveLength(0);
  });

  it("keeps availability date-agnostic", async () => {
    const document = await readPage("index.html");

    expect(document.querySelector(".availability")?.textContent.trim()).toBe(
      "Accepting 1 client",
    );
  });

  it("keeps the linked availability target at least 44px high", async () => {
    const document = await readPage("index.html");
    const availability = document.querySelector(
      "a.availability[href='/services#packages']",
    );
    const bundledCss = (
      await Promise.all(
        outputFiles
          .filter((filePath) => filePath.endsWith(".css"))
          .map(readOutput),
      )
    ).join("\n");
    const availabilityRule = bundledCss.match(
      /\.availability\{([^}]*)\}/,
    )?.[1];

    expect(availability).not.toBeNull();
    expect(availabilityRule).toContain("min-height:44px");
  });

  it("loads site behaviour from a same-origin external module", async () => {
    const siteOrigin = "https://oliverhitchings.com";

    for (const filePath of contentPages) {
      const document = await readPage(filePath);
      const moduleScripts = Array.from(
        document.querySelectorAll("script[type='module']"),
      );
      const inlineModuleSource = moduleScripts
        .filter((script) => !script.hasAttribute("src"))
        .map((script) => script.textContent)
        .join("\n");
      const externalModules = moduleScripts.filter((script) =>
        script.hasAttribute("src"),
      );
      const externalSources = await Promise.all(
        externalModules.map(async (script) => {
          const sourceUrl = new URL(script.getAttribute("src"), siteOrigin);
          const outputPath = decodeURIComponent(sourceUrl.pathname).replace(
            /^\/+/,
            "",
          );

          return {
            source: await readOutput(outputPath),
            sourceUrl,
          };
        }),
      );
      const behaviourModule = externalSources.find(({ source }) =>
        source.includes("[data-reveal]"),
      );

      expect(inlineModuleSource, filePath).not.toContain("[data-reveal]");
      expect(behaviourModule, filePath).toBeDefined();
      expect(behaviourModule.sourceUrl.origin, filePath).toBe(siteOrigin);
      expect(behaviourModule.sourceUrl.pathname, filePath).toMatch(
        /^\/_astro\/[^?#]+\.js$/,
      );
    }
  });

  it("renders exactly one page-level h1 on every content page", async () => {
    expect(contentPages.length).toBeGreaterThan(0);

    for (const filePath of contentPages) {
      const document = await readPage(filePath);
      expect(document.querySelectorAll("h1"), filePath).toHaveLength(1);
    }
  });

  it("bundles the exact local Archivo variable font without remote font hosts", async () => {
    const packageManifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const generatedSourceFiles = outputFiles.filter((filePath) =>
      /\.(?:css|html)$/.test(filePath),
    );
    const generatedSources = await Promise.all(
      generatedSourceFiles.map(readOutput),
    );
    const bundledCss = generatedSources
      .filter((_source, index) => generatedSourceFiles[index].endsWith(".css"))
      .join("\n");
    const generatedSource = generatedSources.join("\n");

    expect(packageManifest.dependencies?.["@fontsource-variable/archivo"]).toBe(
      "5.2.8",
    );
    expect(bundledCss).toMatch(/font-family:\s*["']?Archivo Variable/i);
    expect(outputFiles.some((filePath) => filePath.endsWith(".woff2"))).toBe(
      true,
    );
    expect(generatedSource).not.toMatch(
      /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|p\.typekit\.net|fonts\.bunny\.net|cloud\.typography\.com|fast\.fonts\.net/i,
    );
  });
});
