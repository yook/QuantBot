#!/usr/bin/env node
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import iconGen from "icon-gen";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const src = path.resolve(process.cwd(), "public", "quant.png");
  if (!fs.existsSync(src)) {
    console.error("Source icon not found:", src);
    process.exit(2);
  }

  const outDir = path.resolve(process.cwd(), "public");
  fs.mkdirSync(outDir, { recursive: true });

  try {
    await iconGen(src, outDir, {
      report: true,
      ico: { name: "quant" },
      icns: { name: "quant" },
      sizes: {
        png: [512, 256, 128, 64, 48, 32, 16],
      },
    });
    console.log("Icons generated to", outDir);
  } catch (err) {
    console.error("Failed to generate icons:", err);
    process.exit(1);
  }
}

run();
