export const DEFERRED_TESTS = ["extra/third.test.mjs", "tests/browser.test.mjs", "tests/headless.test.mjs", "unnamed/another.test.mjs"];
export const DEFERRED_BROWSER = "tests/browser.test.mjs";
export const DEFERRED_SELECTED = DEFERRED_TESTS.filter((path) => path !== DEFERRED_BROWSER);
export const DEFERRED_CONFIG = "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n" +
  "  checks:\n    - {id: integrity, command: node static.mjs front}\n" +
  "    - {id: after, command: 'node static.mjs after {evidence}', after: tests, needs: [integrity]}\n" +
  "  tests:\n    - {id: browser, command: 'node {test}', under: tests/, reaching: [lib/browser]}\n" +
  "    - {id: headless, command: 'node {test}', under: tests/}\n" +
  "    - {id: third, command: 'node {test}', under: extra/}\n" +
  "    - {command: 'node {test}', under: unnamed/}\n```\n";

// An application whose deferred group fails if run, with two other named groups and an unnamed group.
export function deferredGroupFixture(): Readonly<Record<string, string>> {
  return {
    ".git/HEAD": "ref: refs/heads/main\n", "package.json": '{"type":"module"}',
    "kit/config.md": DEFERRED_CONFIG, "integrity.txt": "good",
    "static.mjs": "import {readFileSync,writeFileSync} from 'node:fs';\n" +
      "if(readFileSync('integrity.txt','utf8')!=='good') process.exit(9);\n" +
      "if(process.argv[2]==='after') writeFileSync('after-evidence.json',JSON.stringify(Object.keys(JSON.parse(readFileSync(process.argv[3],'utf8')).tests).sort()));\n",
    "lib/browser.mjs": "import {writeFileSync} from 'node:fs'; writeFileSync('browser-executed.txt','yes');\n",
    "lib/relay.mjs": "import './browser.mjs';\n",
    [DEFERRED_BROWSER]: "import '../lib/relay.mjs'; process.exit(17);\n",
    "tests/headless.test.mjs": "import {writeFileSync} from 'node:fs'; writeFileSync('headless-executed.txt','yes');\n",
    "extra/third.test.mjs": "import {writeFileSync} from 'node:fs'; writeFileSync('third-executed.txt','yes');\n",
    "unnamed/another.test.mjs": "import {writeFileSync} from 'node:fs'; writeFileSync('unnamed-executed.txt','yes');\n",
  };
}
