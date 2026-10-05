import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const directory = path.resolve("build/server/assets");
const names = (await readdir(directory)).filter(
  (name) => name.startsWith("server-build-") && name.endsWith(".js"),
);

let updated = 0;
for (const name of names) {
  const file = path.join(directory, name);
  const source = await readFile(file, "utf8");
  const next = source.replace(
    /const assetsBuildDirectory = "build\\+client";/g,
    'const assetsBuildDirectory = "build/client";',
  );
  if (next !== source) {
    await writeFile(file, next);
    updated += 1;
  }
}

if (updated === 0) {
  const sample = names[0] ? await readFile(path.join(directory, names[0]), "utf8") : "";
  if (!sample.includes('const assetsBuildDirectory = "build/client";')) {
    throw new Error("Could not find assetsBuildDirectory in the server build.");
  }
}

console.log(`posix asset path updated in ${updated} server build file(s)`);
