import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const sourceRoot = path.join(repoRoot, "src");
const outputRoot = path.join(sourceRoot, ".artifacts");

const bundles = [
  {
    name: "orders-api",
    entry: path.join(sourceRoot, "services/orders/handler.ts"),
    outfile: path.join(outputRoot, "orders-api/index.js"),
  },
  {
    name: "invoices-api",
    entry: path.join(sourceRoot, "services/invoices/handler.ts"),
    outfile: path.join(outputRoot, "invoices-api/index.js"),
  },
  {
    name: "invoices-sqs",
    entry: path.join(sourceRoot, "services/invoices/handler.ts"),
    outfile: path.join(outputRoot, "invoices-sqs/index.js"),
  },
  {
    name: "payments-sqs",
    entry: path.join(sourceRoot, "services/payments/handler.ts"),
    outfile: path.join(outputRoot, "payments-sqs/index.js"),
  },
  {
    name: "shipments-api",
    entry: path.join(sourceRoot, "services/shipments/handler.ts"),
    outfile: path.join(outputRoot, "shipments-api/index.js"),
  },
  {
    name: "shipments-sqs",
    entry: path.join(sourceRoot, "services/shipments/handler.ts"),
    outfile: path.join(outputRoot, "shipments-sqs/index.js"),
  },
  {
    name: "orders-sqs",
    entry: path.join(sourceRoot, "services/orders/handler.ts"),
    outfile: path.join(outputRoot, "orders-sqs/index.js"),
  },
  {
    name: "inventory-sqs",
    entry: path.join(sourceRoot, "services/inventory/handler.ts"),
    outfile: path.join(outputRoot, "inventory-sqs/index.js"),
  },
  {
    name: "notifications-sqs",
    entry: path.join(sourceRoot, "services/notifications/handler.ts"),
    outfile: path.join(outputRoot, "notifications-sqs/index.js"),
  },
];

async function main() {
  fs.rmSync(outputRoot, { recursive: true, force: true });

  await Promise.all(
    bundles.map((bundle) =>
      build({
        absWorkingDir: repoRoot,
        entryPoints: [bundle.entry],
        outfile: bundle.outfile,
        bundle: true,
        format: "cjs",
        platform: "node",
        target: "node20",
        sourcemap: "external",
        minify: false,
        legalComments: "none",
        external: [],
      }),
    ),
  );

  const manifest = Object.fromEntries(
    bundles.map((bundle) => [
      bundle.name,
      path.relative(repoRoot, path.dirname(bundle.outfile)),
    ]),
  );

  fs.writeFileSync(
    path.join(outputRoot, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
