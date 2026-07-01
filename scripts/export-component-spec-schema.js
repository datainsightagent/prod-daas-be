import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { componentSpecJsonSchema } from "../src/contracts/componentSpec.contract.js";
import { datasetJsonSchemaByType } from "../src/contracts/componentDataset.contract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "src", "contracts", "generated");

mkdirSync(outDir, { recursive: true });

const bundle = {
  component_spec: componentSpecJsonSchema(),
  datasets: datasetJsonSchemaByType(),
  spec_version: 2,
  chart_types: ["value", "line", "bar", "row", "pie", "table"],
};

const outPath = join(outDir, "text2component.schema.json");
writeFileSync(outPath, JSON.stringify(bundle, null, 2), "utf8");

console.log(`Wrote ${outPath}`);
