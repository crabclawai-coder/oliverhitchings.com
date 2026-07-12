import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerConfigPath = join(projectRoot, "contact-worker/wrangler.toml");
const workerHandlerPath = join(projectRoot, "contact-worker/src/index.js");
const legacyPagesHandlerPath = join(projectRoot, "functions/api/contact.js");
const legacyPagesBuildPath = join(
  projectRoot,
  "scripts/build-pages-functions.mjs",
);

const requireMissing = async (path, description) => {
  try {
    await access(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }

    throw error;
  }

  throw new Error(`${description} must not exist.`);
};

const workerConfig = parse(await readFile(workerConfigPath, "utf8"));

if (workerConfig.vars?.TURNSTILE_MODE !== "enforce") {
  throw new Error(
    "The production [vars] table must set TURNSTILE_MODE to enforce.",
  );
}

if (workerConfig.vars?.RATE_LIMIT_MODE !== "off") {
  throw new Error(
    "The production [vars] table must keep RATE_LIMIT_MODE off until its binding is provisioned.",
  );
}

if (
  !Array.isArray(workerConfig.send_email) ||
  workerConfig.send_email.length !== 1 ||
  workerConfig.send_email[0]?.name !== "CONTACT_EMAIL"
) {
  throw new Error(
    "The first Resend release must preserve the existing CONTACT_EMAIL binding until post-release cleanup.",
  );
}

await access(workerHandlerPath);
await requireMissing(
  legacyPagesHandlerPath,
  "The legacy Pages contact handler",
);
await requireMissing(
  legacyPagesBuildPath,
  "The legacy Pages Functions build helper",
);

console.log(
  "Contact release configuration verified: one protected backend, Turnstile enforced, rate limiting off, migration binding preserved.",
);
