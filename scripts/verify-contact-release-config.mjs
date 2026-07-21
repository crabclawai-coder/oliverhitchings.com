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

if (workerConfig.send_email !== undefined) {
  throw new Error(
    "The Resend Worker must not restore the removed legacy Cloudflare Email Service binding.",
  );
}

const productionObservability = workerConfig.observability;

if (
  productionObservability?.enabled !== false ||
  productionObservability?.head_sampling_rate !== 1 ||
  productionObservability?.logs?.enabled !== true ||
  productionObservability?.logs?.head_sampling_rate !== 1 ||
  productionObservability?.logs?.invocation_logs !== true ||
  productionObservability?.logs?.persist !== true ||
  productionObservability?.traces?.enabled !== false ||
  productionObservability?.traces?.head_sampling_rate !== 1 ||
  productionObservability?.traces?.persist !== true
) {
  throw new Error(
    "The production observability configuration must match the reviewed Cloudflare dashboard-generated settings.",
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
  "Contact release configuration verified: one protected backend, Turnstile enforced, rate limiting off, legacy email binding absent, dashboard log settings preserved.",
);
