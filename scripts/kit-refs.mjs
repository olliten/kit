import { sourceLoader } from "../src/substrate/adapters/source-loader.mjs";

if (sourceLoader.isMain(import.meta.url))
  await sourceLoader.run(import.meta.url, "src/substrate/compositions/refs-run.ts", "runRefs");
