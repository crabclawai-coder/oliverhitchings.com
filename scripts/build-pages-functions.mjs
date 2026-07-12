import { execFileSync } from "node:child_process";
import {
  access,
  copyFile,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildOutputDirectory = join(projectRoot, "dist");
const wranglerPath = join(
  projectRoot,
  "node_modules/wrangler/bin/wrangler.js",
);

await access(buildOutputDirectory);
await access(wranglerPath);

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "oliver-pages-functions-"),
);
const routesPath = join(buildOutputDirectory, "_routes.json");
const workerPath = join(buildOutputDirectory, "_worker.js");

try {
  execFileSync(
    process.execPath,
    [
      wranglerPath,
      "pages",
      "functions",
      "build",
      "functions",
      "--outdir",
      temporaryDirectory,
      "--project-directory",
      projectRoot,
      "--build-output-directory",
      buildOutputDirectory,
      "--output-routes-path",
      routesPath,
    ],
    { cwd: projectRoot, stdio: "inherit" },
  );

  await copyFile(join(temporaryDirectory, "index.js"), workerPath);

  const [workerSource, routesSource] = await Promise.all([
    readFile(workerPath, "utf8"),
    readFile(routesPath, "utf8"),
  ]);
  const routes = JSON.parse(routesSource);

  if (!workerSource.includes("CONTACT_TO_EMAIL")) {
    throw new Error(
      "The compiled Pages fallback does not require CONTACT_TO_EMAIL.",
    );
  }

  if (/gmail\.com/i.test(workerSource)) {
    throw new Error(
      "The compiled Pages fallback contains a personal destination domain.",
    );
  }

  if (
    !Array.isArray(routes.include) ||
    !routes.include.includes("/api/contact")
  ) {
    throw new Error(
      "The compiled Pages fallback routes do not include /api/contact.",
    );
  }

  console.log(
    `Pages Functions artifact built: ${workerSource.length} bytes; ${routes.include.length} included route(s).`,
  );
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
