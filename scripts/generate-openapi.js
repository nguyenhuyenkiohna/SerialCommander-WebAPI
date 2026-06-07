#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

require("rootpath")();
const { openapiSpecification } = require("../kernels/api-docs");

const outputDir = path.join(__dirname, "..", "openapi");
const outputFile = path.join(outputDir, "openapi.json");

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(openapiSpecification, null, 2)}\n`, "utf8");

console.log(`[openapi] Generated snapshot: ${outputFile}`);
