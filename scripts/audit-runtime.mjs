import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));
let checked = 0;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".git"].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await inspect(file);
    else if (entry.name.endsWith(".js")) {
      new vm.Script(await readFile(file, "utf8"), { filename: file });
      checked += 1;
    }
  }
}
for (const entry of await readdir(path.join(root, "cloudfunctions"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const functionRoot = path.join(root, "cloudfunctions", entry.name);
  const pkg = JSON.parse(await readFile(path.join(functionRoot, "package.json"), "utf8"));
  await readFile(path.join(functionRoot, pkg.main || "index.js"), "utf8");
}
await inspect(path.join(root, "cloudfunctions"));
await inspect(path.join(root, "miniprogram"));
console.log(`运行时代码语法检查通过：${checked} 个小程序与云函数文件`);
