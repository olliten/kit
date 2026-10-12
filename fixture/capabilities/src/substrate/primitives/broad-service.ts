export interface BroadService {
  readonly read: (key: string) => string;
  readonly put: (key: string, value: string) => void;
  readonly remove: (key: string) => void;
}

export function save(service: BroadService, key: string, value: string): void {
  service.put(key, value);
}
