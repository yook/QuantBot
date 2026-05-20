#!/usr/bin/env node
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import iconGen from "icon-gen";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const repoRoot = path.resolve(__dirname, "..");
  const src = path.join(repoRoot, "public", "pageviewer.png");
  if (!fs.existsSync(src)) {
    console.error("Source icon not found:", src);
    process.exit(2);
  }

  const outDir = path.join(repoRoot, "build", "icons");
  fs.mkdirSync(outDir, { recursive: true });

  try {
    await iconGen(src, outDir, {
      report: true,
      ico: { name: "pageviewer" },
      icns: { name: "pageviewer" },
      sizes: {
        png: [512, 256, 128, 64, 48, 32, 16],
      },
    });
    // Генерация отдельного PNG 512x512 с именем hfpvthfvb.png
    const sharp = (await import('sharp')).default;
    await sharp(src)
      .resize(512, 512)
      .toFile(path.join(outDir, 'pageviewer.png'));
    console.log("Icons generated to", outDir);
  } catch (err) {
    console.error("Failed to generate icons:", err);
    process.exit(1);
  }
}

run();
