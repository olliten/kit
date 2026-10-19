import { expect, test } from "vitest";
import { verificationPartition } from "../../src/core/readings/verification-partition.js";

const checks = Array.from({ length: 17 }, (_, i) => ({
  id: `test:${String(i).padStart(2, "0")}`,
  inputs: `tree:${i}`,
  contract: "test:v1",
  strength: 100,
  resource: i % 2 === 0 ? "unit" : "browser",
  needs: [],
  ...(i % 3 === 0 ? {} : { milliseconds: (i + 1) * 10 }),
}));

test("every worker count partitions the required checks exactly once", () => {
  for (let size = 0; size <= checks.length; size++)
    for (let count = 1; count <= 8; count++) {
      const selected = checks.slice(0, size);
      const partition = verificationPartition(selected, count);
      expect(partition.parts).toHaveLength(count);
      expect(partition.loads).toHaveLength(count);
      const ids = partition.parts.flat().map((c) => c.id);
      expect(ids.sort()).toEqual(selected.map((c) => c.id).sort());
      expect(new Set(ids).size).toBe(size);
    }
});

test("input order cannot change worker assignment, including equal and unknown durations", () => {
  for (let count = 1; count <= 8; count++) {
    const expected = verificationPartition(checks, count);
    expect(verificationPartition([...checks].reverse(), count)).toEqual(expected);
    for (let offset = 1; offset < checks.length; offset++)
      expect(
        verificationPartition([...checks.slice(offset), ...checks.slice(0, offset)], count),
      ).toEqual(expected);
  }
});

test("known long checks start in the least loaded workers", () => {
  const timed = checks
    .slice(0, 3)
    .map((c, i) => ({ ...c, milliseconds: [90, 80, 10][i] as number }));
  const partition = verificationPartition(timed, 2, [100, 0]);
  expect(partition.parts.map((part) => part.map((c) => c.id))).toEqual([
    [timed[2]?.id],
    [timed[0]?.id, timed[1]?.id],
  ]);
  expect(partition.loads).toEqual([110, 170]);
});

test("unknown durations use the median of their resource rather than another resource's cost", () => {
  const jobs = [
    {
      ...checks[0],
      id: "a",
      inputs: "a",
      contract: "v1",
      strength: 1,
      resource: "unit",
      needs: [],
      milliseconds: 10,
    },
    {
      ...checks[0],
      id: "b",
      inputs: "b",
      contract: "v1",
      strength: 1,
      resource: "unit",
      needs: [],
      milliseconds: 30,
    },
    { id: "c", inputs: "c", contract: "v1", strength: 1, resource: "unit", needs: [] },
    {
      id: "d",
      inputs: "d",
      contract: "v1",
      strength: 1,
      resource: "browser",
      needs: [],
      milliseconds: 1000,
    },
    { id: "e", inputs: "e", contract: "v1", strength: 1, resource: "browser", needs: [] },
  ];
  expect(verificationPartition(jobs, 1).loads).toEqual([2060]);
});
