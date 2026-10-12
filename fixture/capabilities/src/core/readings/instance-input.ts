export class WithMethod {
  value(): string {
    return "read";
  }
}

export const input: WithMethod = new WithMethod();
