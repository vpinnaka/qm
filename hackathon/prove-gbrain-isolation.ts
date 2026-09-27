import { parseMemoryProviderConfig } from "../src/memory/provider-config.ts";
import { createConfiguredMemoryService } from "../src/memory/provider-factory.ts";
import type { MemoryService } from "../src/memory/memory-service.ts";

const config = parseMemoryProviderConfig(process.env.MEMORY_PROVIDER_CONFIG, process.env);
if (!config) throw new Error("set MEMORY_PROVIDER_CONFIG");

const memory = createConfiguredMemoryService({
  defaultMemory: {
    recall: async () => "",
    capture: async () => 0,
    query: async () => [],
    read: async () => "",
    replace: async () => {},
  } as unknown as MemoryService,
  config,
});

const NORTHWIND = process.argv[2] ?? "group:web-project-northwind";
const COBALT = process.argv[3] ?? "group:web-project-cobalt";

const nw = await memory.recall(NORTHWIND, { query: "fuel card GL account" });
const cb = await memory.recall(COBALT, { query: "fuel card GL account" });

const checks: Array<[string, boolean]> = [
  ["northwind recall mentions Northwind", /Northwind/.test(nw)],
  ["northwind recall has no Cobalt facts", !/Cobalt/.test(nw)],
  ["cobalt recall mentions Cobalt", /Cobalt/.test(cb)],
  ["cobalt recall has no Northwind facts", !/Northwind/.test(cb)],
  ["cobalt knows the 6120 fuel rule", /6120/.test(cb)],
];

const marker = `capture probe ${Date.now()}`;
await memory.capture(COBALT, [marker], new Date().toISOString(), "prove-script", { mode: "explicit" });
const after = await memory.recall(COBALT, { query: "capture probe" });
const nwAfter = await memory.recall(NORTHWIND, { query: "capture probe" });
checks.push(["capture landed in cobalt", after.includes(marker)]);
checks.push(["capture did not leak to northwind", !nwAfter.includes(marker)]);

for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
console.log("\n--- northwind recall (first 400 chars)\n" + nw.slice(0, 400));
console.log("\n--- cobalt recall (first 400 chars)\n" + cb.slice(0, 400));
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
