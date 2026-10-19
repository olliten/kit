export interface VerificationCheck {
  readonly id: string;
  readonly inputs: string | null;
  readonly contract: string;
  readonly strength: number;
  readonly resource: string;
  readonly needs: readonly string[];
  readonly milliseconds?: number;
}

export interface VerificationEvidence {
  readonly id: string;
  readonly inputs: string;
  readonly contract: string;
  readonly strength: number;
  readonly passed: boolean;
}

export interface VerificationState {
  readonly completed?: Readonly<Record<string, boolean>>;
  readonly running?: readonly string[];
  readonly capacity?: Readonly<Record<string, number>>;
  readonly reuse?: boolean;
}

export interface VerificationPlan {
  readonly ready: readonly VerificationCheck[];
  readonly reused: readonly string[];
  readonly blocked: readonly string[];
  readonly pending: readonly string[];
  readonly complete: boolean;
  readonly passed: boolean;
}
