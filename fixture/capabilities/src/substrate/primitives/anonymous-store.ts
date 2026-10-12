export function put(writer: { readonly put: (value: string) => void }, value: string): void {
  writer.put(value);
}
