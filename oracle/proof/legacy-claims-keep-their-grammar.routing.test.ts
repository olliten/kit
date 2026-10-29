import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { processes } from "../../src/substrate/adapters/processes.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const engine = fileURLToPath(new URL("../..", import.meta.url));

test.each([
	{ proof: true, reaches: true, key: null },
	{
		proof: false,
		reaches: true,
		key: "R3:missing-proof:spec/old.md:value-stays",
	},
	{
		proof: true,
		reaches: false,
		key: "R4:unreached-module:spec/old.md:value-stays:value",
	},
])(
	"legacy metadata enables the real proof checks: %j",
	({ proof, reaches, key }) => {
		const project = temporaryProjects.open("kit-legacy-proof-");
		try {
			project.write({
				"src/core/primitives/value.ts": "export const value = 7;\n",
				"spec/terms.md":
					"- **value** — A supplied value.\n  - Role: fact\n  - Zone: core\n  - Of: []\n",
				"spec/old.md":
					"# Old\n\n- A supplied value stays. · {#value-stays}\n" +
					"  - An explanatory child stays here.\n  - Proof: {{value}}\n" +
					"- An unmigrated claim keeps its existing proofs. · {#legacy-only}\n",
				...(proof
					? {
							"oracle/old/value-stays.test.ts": reaches
								? "import { value } from '../../src/core/primitives/value.js'; export const observed = value;\n"
								: "export {};\n",
						}
					: {}),
				"tsconfig.json": JSON.stringify({
					compilerOptions: {
						strict: true,
						target: "ES2022",
						module: "NodeNext",
						moduleResolution: "NodeNext",
						types: [],
						skipLibCheck: true,
					},
					include: ["src/**/*.ts", "oracle/**/*.ts"],
				}),
				"package.json": JSON.stringify({ type: "module" }),
				"kit-config.md":
					"```yaml\nroots:\n  src: src/\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\nlegacy-areas: [spec/old.md]\nadapters: []\npackages: []\n```\n",
				"baseline.json": "{}",
			});
			const result = processes.run(
				processes.node(),
				[
					join(engine, "scripts/kit-check.mjs"),
					`--root=${project.root}`,
					`--config=${join(project.root, "kit-config.md")}`,
					`--baseline=${join(project.root, "baseline.json")}`,
					"--report",
				],
				engine,
			);
			expect(result.status).toBe(0);
			const findings = JSON.parse(result.stdout).findings;
			expect(findings.map((item: { debtKey: string }) => item.debtKey)).toEqual(
				key === null ? [] : [key],
			);
		} finally {
			project.dispose();
		}
	},
);
