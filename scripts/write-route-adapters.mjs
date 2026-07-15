import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPublicRouteSpecs,
  writePublicRouteAdapters,
} from "../lib/public-routes.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const snapshot = JSON.parse(
  await readFile(resolve(projectRoot, "data/live-snapshot.json"), "utf8"),
);
const aShareCodes = (snapshot.aShare?.quotes || []).map((item) => item.code);
const specs = buildPublicRouteSpecs(snapshot, { aShareCodes });

await writePublicRouteAdapters(projectRoot, specs);
console.log(`已生成 ${specs.length} 个公开短链接入口`);
