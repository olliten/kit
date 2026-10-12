export const input: { readonly value: string } = new Proxy(
  { value: "read" },
  { get: () => "intercepted" },
);
