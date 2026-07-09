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
