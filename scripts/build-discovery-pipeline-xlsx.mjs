import fs from "node:fs";
import path from "node:path";
import {
  buildDiscoveryPipelineFileName,
  buildDiscoveryPipelineWorkbookBuffer,
} from "../src/lib/spreadsheetReporting.js";

const inputPath = process.argv[2];
const outputArg = process.argv[3];

if (!inputPath) {
  console.error("Usage: node scripts/build-discovery-pipeline-xlsx.mjs <lead-helper-backup.json> [output.xlsx|output-dir]");
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const defaultOutputDir = path.resolve("output", "discovery-pipeline");
const outputPath = outputArg
  ? path.extname(outputArg).toLowerCase() === ".xlsx"
    ? path.resolve(outputArg)
    : path.join(path.resolve(outputArg), buildDiscoveryPipelineFileName())
  : path.join(defaultOutputDir, buildDiscoveryPipelineFileName());

const { buffer, rows } = buildDiscoveryPipelineWorkbookBuffer(state);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, buffer);

console.log(JSON.stringify({ outputPath, rows: rows.length }, null, 2));
