// Read the kit's single configuration fence; consumers select their own declared fields.
import { JSON_SCHEMA, load } from "js-yaml";

export function kitConfig(text) {
  const fences = [...text.matchAll(/^```yaml[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)];
  if (fences.length !== 1)
    throw new Error("kit/config.md must contain one YAML configuration fence");
  const config = load(fences[0][1], { schema: JSON_SCHEMA });
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("kit/config.md must declare a configuration mapping");
  return config;
}
