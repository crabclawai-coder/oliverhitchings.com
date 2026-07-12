import { build } from "astro";
import { JSDOM } from "jsdom";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { posts, site } from "./data/site.js";

const projectRoot = new URL("../", import.meta.url);
const redirectPages = new Set(["now/index.html", "pilot/index.html"]);

let buildDirectory;
let temporaryDirectory;
let outputFiles;
let contentPages;
let normalPages;

const siteOrigin = "https://oliverhitchings.com";
const socialImageUrl = `${siteOrigin}/images/social/oliver-hitchings-og.jpg`;
const socialImageAlt = "Oliver Hitchings — inspectable automation systems";
const expectedRobots = `User-agent: *
Allow: /

Sitemap: https://oliverhitchings.com/sitemap-index.xml
`;
const expectedHeaders = `/*
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
  Content-Security-Policy-Report-Only: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com; frame-src https://challenges.cloudflare.com; worker-src 'self'; manifest-src 'self'
`;
const expectedRedirects = [
  "/pilot /services/#packages 301",
  "/pilot/ /services/#packages 301",
  "/now /about/ 301",
  "/now/ /about/ 301",
  "/sitemap.xml /sitemap-index.xml 301",
];
const prohibitedStructuredDataFields = new Set([
  "address",
  "telephone",
  "review",
  "reviews",
  "aggregateRating",
  "rating",
  "client",
  "clients",
  "sameAs",
  "areaServed",
  "serviceArea",
  "foundingDate",
  "qualification",
  "qualifications",
  "outcome",
  "outcomes",
]);

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

async function readOutputBuffer(filePath) {
  return readFile(join(buildDirectory, filePath));
}

async function readPage(filePath) {
  return new JSDOM(await readOutput(filePath)).window.document;
}

function jpegDimensions(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Expected a JPEG start-of-image marker");
  }

  const startOfFrameMarkers = new Set([
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf,
  ]);
  let offset = 2;

  while (offset < buffer.length) {
    while (buffer[offset] === 0xff) {
      offset += 1;
    }

    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      continue;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      throw new Error("Invalid JPEG segment length");
    }

    if (startOfFrameMarkers.has(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }

    offset += segmentLength;
  }

  throw new Error("JPEG dimensions were not found");
}

function collectObjectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys);
    return keys;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectObjectKeys(child, keys);
    }
  }

  return keys;
}

function expectedPageUrl(filePath) {
  if (filePath === "index.html") return `${siteOrigin}/`;

  const pathname = filePath.endsWith("/index.html")
    ? `/${filePath.slice(0, -"index.html".length)}`
    : `/${filePath}`;

  return new URL(pathname, siteOrigin).href;
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
  normalPages = contentPages.filter((filePath) => filePath !== "404.html");
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
    const headerActions = document.querySelectorAll(".site-header .nav-cta");
    const footerAction = document.querySelector(
      ".site-footer .footer-links > div:last-child a[href='/services#contact']",
    );
    const frameEmailLinks = document.querySelectorAll(
      ".site-header a[href^='mailto:'], .site-footer a[href^='mailto:']",
    );

    expect(headerActions).toHaveLength(2);
    for (const headerAction of headerActions) {
      expect(headerAction.getAttribute("href")).toBe("/services#contact");
      expect(headerAction.textContent.trim()).toBe("Start an enquiry");
    }
    expect(footerAction).not.toBeNull();
    expect(frameEmailLinks).toHaveLength(0);
  });

  it("renders matching desktop and compact primary navigation contracts", async () => {
    const document = await readPage("index.html");
    const navigation = document.querySelector("[data-mobile-navigation]");
    const toggle = navigation?.querySelector("[data-mobile-menu-toggle]");
    const panel = navigation?.querySelector("[data-mobile-menu-panel]");
    const expectedLinks = [
      ["Home", "/"],
      ["Services", "/services"],
      ["About", "/about"],
      ["Blog", "/blog"],
    ];
    const linkContract = (selector) =>
      Array.from(navigation?.querySelectorAll(selector) ?? [], (link) => [
        link.textContent.trim(),
        link.getAttribute("href"),
      ]);

    expect(navigation).not.toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.getAttribute("aria-controls")).toBe(
      "mobile-primary-navigation",
    );
    expect(panel?.id).toBe("mobile-primary-navigation");
    expect(panel?.hasAttribute("inert")).toBe(true);
    expect(linkContract("[data-desktop-navigation-links] a")).toEqual(
      expectedLinks,
    );
    expect(linkContract("[data-mobile-menu-panel] a")).toEqual(expectedLinks);
    expect(
      navigation.querySelectorAll(
        "[data-desktop-navigation-links] a[aria-current='page']",
      ),
    ).toHaveLength(1);
    expect(
      navigation.querySelectorAll(
        "[data-mobile-menu-panel] a[aria-current='page']",
      ),
    ).toHaveLength(1);
  });

  it("keeps compact navigation controls at least 44px square", async () => {
    const bundledCss = (
      await Promise.all(
        outputFiles
          .filter((filePath) => filePath.endsWith(".css"))
          .map(readOutput),
      )
    ).join("\n");
    const compactControlsRule = bundledCss.match(
      /\.mobile-navigation-actions>\*\{([^}]*)\}/,
    )?.[1];
    const compactPanelLinksRule = bundledCss.match(
      /\.mobile-navigation-panel a\{([^}]*)\}/,
    )?.[1];

    expect(compactControlsRule).toContain("min-width:44px");
    expect(compactControlsRule).toContain("min-height:44px");
    expect(compactPanelLinksRule).toContain("min-width:44px");
    expect(compactPanelLinksRule).toContain("min-height:44px");
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

  it("loads navigation, site, scroll-film and media behaviour from same-origin external modules", async () => {
    const siteOrigin = "https://oliverhitchings.com";
    const layoutSource = await readFile(
      new URL("./layouts/BaseLayout.astro", import.meta.url),
      "utf8",
    );
    const navigationInitialization = layoutSource.indexOf(
      "initializeMobileNavigation();",
    );
    const scrollFilmInitialization = layoutSource.indexOf(
      "initializeScrollFilms();",
    );
    const mediaInitialization = layoutSource.indexOf("initializeMedia();");

    expect(navigationInitialization).toBeGreaterThan(-1);
    expect(scrollFilmInitialization).toBeGreaterThan(navigationInitialization);
    expect(mediaInitialization).toBeGreaterThan(scrollFilmInitialization);

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
      const navigationModule = externalSources.find(({ source }) =>
        source.includes("[data-mobile-navigation]"),
      );
      const scrollFilmModule = externalSources.find(({ source }) =>
        source.includes("video[data-scroll-film]"),
      );
      const mediaModule = externalSources.find(({ source }) =>
        source.includes("video[data-media]"),
      );

      expect(inlineModuleSource, filePath).not.toContain("[data-reveal]");
      expect(inlineModuleSource, filePath).not.toContain(
        "[data-mobile-navigation]",
      );
      expect(inlineModuleSource, filePath).not.toContain(
        "video[data-scroll-film]",
      );
      expect(inlineModuleSource, filePath).not.toContain("video[data-media]");

      for (const module of [
        navigationModule,
        behaviourModule,
        scrollFilmModule,
        mediaModule,
      ]) {
        expect(module, filePath).toBeDefined();
        expect(module.sourceUrl.origin, filePath).toBe(siteOrigin);
        expect(module.sourceUrl.pathname, filePath).toMatch(
          /^\/_astro\/[^?#]+\.js$/,
        );
      }
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

describe("generated discovery and response policy", () => {
  it("publishes the required discovery, policy, 404 and social-image files", () => {
    expect(outputFiles).toEqual(
      expect.arrayContaining([
        "robots.txt",
        "_headers",
        "_redirects",
        "404.html",
        "images/social/oliver-hitchings-og.jpg",
      ]),
    );
  });

  it("publishes the exact robots policy and sitemap alias without losing legacy aliases", async () => {
    expect(await readOutput("robots.txt")).toBe(expectedRobots);

    const redirects = (await readOutput("_redirects"))
      .split(/\r?\n/)
      .filter(Boolean);
    for (const expectedRedirect of expectedRedirects) {
      expect(redirects).toContain(expectedRedirect);
    }
    expect(
      redirects.filter(
        (redirect) => redirect === "/sitemap.xml /sitemap-index.xml 301",
      ),
    ).toHaveLength(1);
  });

  it("links the sitemap chunk and excludes redirect and status-code routes", async () => {
    const sitemapIndex = await readOutput("sitemap-index.xml");
    const sitemap = await readOutput("sitemap-0.xml");

    expect(sitemapIndex).toContain(
      "https://oliverhitchings.com/sitemap-0.xml",
    );
    expect(sitemap).not.toMatch(
      /<loc>https:\/\/oliverhitchings\.com\/(?:404|now|pilot)\/?<\/loc>/,
    );
  });

  it("renders a branded, useful and non-indexable 404 without URL claims", async () => {
    const document = await readPage("404.html");

    expect(document.title).toBe("Page not found | Oliver Hitchings");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")?.textContent.trim()).toBe(
      "That page is not here.",
    );
    expect(document.querySelector("main")?.textContent).toMatch(
      /address may have changed/i,
    );
    expect(
      Array.from(document.querySelectorAll("main a")).map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(expect.arrayContaining(["/", "/services", "/blog"]));
    expect(
      document.querySelector("meta[name='robots']")?.getAttribute("content"),
    ).toBe("noindex,follow");
    expect(document.querySelector("link[rel='canonical']")).toBeNull();
    expect(document.querySelector("meta[property='og:url']")).toBeNull();
    expect(document.querySelector("script[type='application/ld+json']")).toBeNull();
    expect(document.querySelector("body > .skip-link[href='#main-content']")).not.toBeNull();
    expect(document.querySelector("body > .site-header")).not.toBeNull();
    expect(document.querySelector("body > .site-footer")).not.toBeNull();
  });

  it("emits one matching absolute apex canonical and og:url on every normal page", async () => {
    expect(normalPages.length).toBeGreaterThan(0);

    for (const filePath of normalPages) {
      const document = await readPage(filePath);
      const canonicalLinks = document.querySelectorAll("link[rel='canonical']");
      const openGraphUrls = document.querySelectorAll("meta[property='og:url']");

      expect(canonicalLinks, filePath).toHaveLength(1);
      expect(openGraphUrls, filePath).toHaveLength(1);

      const canonical = canonicalLinks[0].getAttribute("href");
      expect(canonical, filePath).toBe(expectedPageUrl(filePath));
      expect(openGraphUrls[0].getAttribute("content"), filePath).toBe(canonical);
    }
  });

  it("emits complete Open Graph and Twitter image metadata on every normal page", async () => {
    for (const filePath of normalPages) {
      const document = await readPage(filePath);
      const content = (selector) =>
        document.querySelector(selector)?.getAttribute("content");

      expect(content("meta[property='og:site_name']"), filePath).toBe(
        "Oliver Hitchings",
      );
      expect(content("meta[property='og:locale']"), filePath).toBe("en_GB");
      expect(content("meta[property='og:image']"), filePath).toBe(
        socialImageUrl,
      );
      expect(content("meta[property='og:image:type']"), filePath).toBe(
        "image/jpeg",
      );
      expect(content("meta[property='og:image:width']"), filePath).toBe("1200");
      expect(content("meta[property='og:image:height']"), filePath).toBe("630");
      expect(content("meta[property='og:image:alt']"), filePath).toBe(
        socialImageAlt,
      );
      expect(content("meta[name='twitter:card']"), filePath).toBe(
        "summary_large_image",
      );
      expect(content("meta[name='twitter:image']"), filePath).toBe(
        socialImageUrl,
      );
      expect(content("meta[name='twitter:image:alt']"), filePath).toBe(
        socialImageAlt,
      );
    }
  });

  it("marks articles with exact article Open Graph publication metadata", async () => {
    const articlePaths = new Set(
      posts.map(({ slug }) => `blog/${slug}/index.html`),
    );

    for (const post of posts) {
      const filePath = `blog/${post.slug}/index.html`;
      const document = await readPage(filePath);

      expect(
        document.querySelector("meta[property='og:type']")?.getAttribute("content"),
        filePath,
      ).toBe("article");
      expect(
        document
          .querySelector("meta[property='article:published_time']")
          ?.getAttribute("content"),
        filePath,
      ).toBe(new Date(`${post.date}T00:00:00Z`).toISOString());
    }

    for (const filePath of normalPages.filter(
      (filePath) => !articlePaths.has(filePath),
    )) {
      const document = await readPage(filePath);

      expect(
        document.querySelector("meta[property='og:type']")?.getAttribute("content"),
        filePath,
      ).toBe("website");
      expect(
        document.querySelector("meta[property='article:published_time']"),
        filePath,
      ).toBeNull();
    }
  });

  it("emits one safe and minimal Person-to-service JSON-LD graph on normal pages", async () => {
    const personId = `${siteOrigin}/#person`;
    const serviceId = `${siteOrigin}/#professional-service`;

    for (const filePath of normalPages) {
      const document = await readPage(filePath);
      const scripts = document.querySelectorAll(
        "script[type='application/ld+json']",
      );

      expect(scripts, filePath).toHaveLength(1);
      expect(scripts[0].textContent, filePath).not.toContain("<");

      const structuredData = JSON.parse(scripts[0].textContent);
      expect(structuredData["@context"], filePath).toBe("https://schema.org");
      expect(structuredData["@graph"], filePath).toHaveLength(2);
      expect(structuredData["@graph"], filePath).toEqual([
        {
          "@type": "Person",
          "@id": personId,
          name: "Oliver Hitchings",
          url: `${siteOrigin}/`,
        },
        {
          "@type": "ProfessionalService",
          "@id": serviceId,
          name: "Oliver Hitchings",
          url: `${siteOrigin}/`,
          description: site.description,
          serviceType: "Business process automation",
          founder: { "@id": personId },
          image: socialImageUrl,
        },
      ]);

      for (const key of collectObjectKeys(structuredData)) {
        expect(prohibitedStructuredDataFields.has(key), `${filePath}: ${key}`).toBe(
          false,
        );
      }
    }
  });

  it("preserves the layout's literal less-than escape for safely embedded JSON-LD", async () => {
    const layoutSource = await readFile(
      new URL("./layouts/BaseLayout.astro", import.meta.url),
      "utf8",
    );
    const escapeLiteralSource = layoutSource.match(
      /const serializedStructuredData = JSON\.stringify\(structuredData\)\.replace\(\s*\/<\/g,\s*("(?:\\.|[^"])*")\s*,?\s*\);/s,
    )?.[1];

    expect(escapeLiteralSource).toBeDefined();

    const lessThanEscape = JSON.parse(escapeLiteralSource);
    const trustedFixture = {
      description: "</script><script>throw new Error('unsafe')</script>",
    };
    const serializedFixture = JSON.stringify(trustedFixture).replace(
      /</g,
      lessThanEscape,
    );
    const fixtureDocument = new JSDOM(
      `<script type="application/ld+json">${serializedFixture}</script>`,
    ).window.document;

    expect(lessThanEscape).toBe("\\u003c");
    expect(serializedFixture).toContain("\\u003c/script>");
    expect(serializedFixture).not.toContain("<");
    expect(JSON.parse(serializedFixture)).toEqual(trustedFixture);
    expect(fixtureDocument.querySelectorAll("script")).toHaveLength(1);
    expect(
      fixtureDocument.querySelectorAll("script:not([type='application/ld+json'])"),
    ).toHaveLength(0);
  });

  it("keeps every executable script external and on an approved origin", async () => {
    const allowedOrigins = new Set([
      siteOrigin,
      "https://challenges.cloudflare.com",
      "https://static.cloudflareinsights.com",
    ]);
    const htmlPages = outputFiles.filter((filePath) => filePath.endsWith(".html"));

    for (const filePath of htmlPages) {
      const document = await readPage(filePath);
      const executableScripts = Array.from(document.querySelectorAll("script")).filter(
        (script) => {
          const type = script.getAttribute("type")?.trim().toLowerCase();
          return (
            !type ||
            type === "module" ||
            type === "text/javascript" ||
            type === "application/javascript"
          );
        },
      );

      for (const script of executableScripts) {
        const source = script.getAttribute("src");
        expect(source, filePath).toBeTruthy();
        expect(script.textContent.trim(), filePath).toBe("");
        expect(allowedOrigins.has(new URL(source, siteOrigin).origin), filePath).toBe(
          true,
        );
      }
    }
  });

  it("publishes a real 1200x630 JPEG within the social-image budget", async () => {
    const image = await readOutputBuffer(
      "images/social/oliver-hitchings-og.jpg",
    );

    expect(jpegDimensions(image)).toEqual({ height: 630, width: 1200 });
    expect(image.byteLength).toBeLessThanOrEqual(500 * 1024);
  });

  it("publishes the exact conservative Pages response policy within platform limits", async () => {
    const headers = await readOutput("_headers");
    const lines = headers.split(/\r?\n/);
    const pathRules = lines.filter(
      (line) => line.trim() && !/^\s/.test(line) && !line.trimStart().startsWith("#"),
    );

    expect(headers).toBe(expectedHeaders);
    expect(pathRules).toEqual(["/*"]);
    expect(pathRules.length).toBeLessThan(100);
    for (const line of lines) {
      expect(line.length, line.slice(0, 80)).toBeLessThan(2_000);
    }

    expect(headers).toContain(
      "Strict-Transport-Security: max-age=31536000",
    );
    expect(headers).not.toMatch(/includeSubDomains|preload/i);
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("X-Frame-Options: DENY");
    expect(headers).toContain(
      "Referrer-Policy: strict-origin-when-cross-origin",
    );
    expect(headers).toContain(
      "Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    );
    expect(headers).toContain("Content-Security-Policy-Report-Only:");
    expect(headers).not.toMatch(/^\s*Content-Security-Policy:/m);

    const reportOnlyPolicy = headers.match(
      /^\s*Content-Security-Policy-Report-Only:\s*(.+)$/m,
    )?.[1];
    const scriptDirective = reportOnlyPolicy
      ?.split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("script-src "));

    expect(scriptDirective).toBe(
      "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
    );
    expect(scriptDirective).not.toContain("'unsafe-inline'");
  });
});
