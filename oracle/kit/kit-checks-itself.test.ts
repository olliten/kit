import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import { commentCheck } from "../../src/core/readings/comment-check.js";
import { nameCheck } from "../../src/core/readings/name-check.js";
import { placementOf } from "../../src/core/readings/placement-of.js";
import { proofReach } from "../../src/core/readings/proof-reach.js";
import { claimCohesion } from "../../src/core/readings/claim-cohesion.js";
import { gate } from "../../src/core/compositions/gate.js";
import { termModel } from "../../src/core/readings/term-model.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { configuredKit, kitConfig } from "../../src/core/readings/kit-configuration.js";
import { bindingFindings } from "../core/readings/binding-findings.js";

// The kit follows its own layout: its claims name its modules, and its tests name its claims.
const KIT = fileURLToPath(new URL("../..", import.meta.url));
const config = configuredKit(
  DEFAULT_CONFIG,
  kitConfig(readFileSync(new URL("../../self-config.md", import.meta.url), "utf8")),
);
const kit = readSnapshot(KIT, config);

test("every kit source file under src/ is placed", () => {
  const legacy = kit.files
    .filter((f) => f.type === "source" && f.path.startsWith("src/"))
    .filter((f) => !placementOf(f.path, "src").placed);
  expect(legacy).toEqual([]);
});

test("the kit's own imports obey R2", () => {
  expect(kit.imports.length).toBeGreaterThan(0);
  expect(dependencyCheck(kit)).toEqual([]);
});

test("the kit's claims, modules and tests bind with no finding", () => {
  expect(kit.claims?.length ?? 0).toBeGreaterThan(0);
  expect(bindingFindings(kit)).toEqual([]);
  expect(proofReach(kit)).toEqual([]);
  expect(claimCohesion(kit)).toEqual([]);
});

test("the kit's own comments cite nothing and carry no debt (R3)", () => {
  expect(kit.comments.length).toBeGreaterThan(0);
  expect(commentCheck(kit)).toEqual([]);
});

test("Kit's real placed homes bind to its actual declared concepts without supporting-word terms", () => {
  const snapshot = kit;
  expect(snapshot.files.some((file) => file.path === "src/core/primitives/term.ts")).toBe(true);
  expect(snapshot.symbols.some((symbol) => symbol.name === "TermSyntaxIssue")).toBe(true);
  expect(snapshot.terms.some((term) => term.term === "syntax" || term.term === "issue")).toBe(
    false,
  );
  expect(termModel(snapshot)).toEqual({ findings: [], limits: [] });
});

test("the kit has unique global definitions and no retired scanned words (R3)", () => {
  expect(kit.terms.length).toBeGreaterThan(0);
  expect(nameCheck(kit)).toEqual([]);
});

test("the gate finds no placed violation in Kit, and Kit carries no legacy debt", () => {
  const { findings } = gate(kit, config);
  expect(findings.filter((item) => item.category !== "checker-limit").map((item) => item.debtKey)).toEqual([]);
});
