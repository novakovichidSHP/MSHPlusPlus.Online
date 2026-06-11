#!/usr/bin/env node
import { build } from "esbuild";

const entry = "assets/vendor/cm6/codemirror.entry.js";
const outfile = "assets/vendor/cm6/codemirror.bundle.js";

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  sourcemap: false,
  minify: false,
  legalComments: "none"
});

console.log(`Built ${outfile}`);
