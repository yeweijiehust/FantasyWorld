import { existsSync, readFileSync } from "node:fs";

const rootPackage = readFileSync("package.json", "utf8");
const apiPackage = readFileSync("apps/api/package.json", "utf8");
const renderYaml = readFileSync("render.yaml", "utf8");

const checks = [
  {
    ok: existsSync("apps/api/dist/src/server.js"),
    message: "apps/api/dist/src/server.js must exist after pnpm build"
  },
  {
    ok: existsSync("apps/web/dist/index.html"),
    message: "apps/web/dist/index.html must exist after pnpm build"
  },
  {
    ok: apiPackage.includes('"start": "node dist/src/server.js"'),
    message: "apps/api start script must point to dist/src/server.js"
  },
  {
    ok: rootPackage.includes('"node": ">=24.0.0 <25"'),
    message: "root package.json must pin Node to the supported 24.x range"
  },
  {
    ok: renderYaml.includes(
      "buildCommand: pnpm install --frozen-lockfile --prod=false && pnpm build && pnpm check:render"
    ),
    message: "render.yaml buildCommand must install dev dependencies and run the render check"
  },
  {
    ok: !renderYaml.includes("corepack enable"),
    message: "render.yaml buildCommand must not run corepack enable"
  },
  {
    ok: !renderYaml.includes("preDeployCommand:"),
    message: "render.yaml must not use preDeployCommand on the free web service"
  },
  {
    ok: renderYaml.includes("startCommand: pnpm db:migrate && pnpm --filter @fantasy-world/api start"),
    message: "render.yaml startCommand must migrate before starting the API"
  },
  {
    ok: renderYaml.includes("value: 24.16.0"),
    message: "render.yaml must pin NODE_VERSION to the CI-tested Node 24 release"
  }
];

const failed = checks.filter((check) => !check.ok);

if (failed.length > 0) {
  for (const check of failed) {
    globalThis.console.error(check.message);
  }

  throw new Error("Render build checks failed");
}

globalThis.console.log("Render build checks passed");
