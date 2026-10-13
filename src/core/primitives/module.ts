// A spec heading `### <zone>/<layer>/<name>`: `name` is the artifact path, `file` the topic file.
export interface SpecHeading {
  readonly file: string;
  readonly name: string;
}
