// The config an app declares; every root is relative to the app root the snapshot was read from.
export interface KitConfig {
  readonly srcRoot: string;
  readonly oracleRoot: string;
  readonly specRoot: string;
}

export const DEFAULT_CONFIG: KitConfig = {
  srcRoot: "src",
  oracleRoot: "oracle",
  specRoot: "spec",
};
