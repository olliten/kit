export function readValue(): number {
  const ambientRead: () => number = () => 7;
  return ambientRead();
}
