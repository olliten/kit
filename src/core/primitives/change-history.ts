// What a change did since its base commit: each file it added, modified or deleted, and its commit messages.
export interface ChangedFile {
  readonly status: "added" | "modified" | "deleted";
  readonly path: string;
}

export interface ChangeHistory {
  readonly files: readonly ChangedFile[];
  readonly messages: readonly string[];
}
