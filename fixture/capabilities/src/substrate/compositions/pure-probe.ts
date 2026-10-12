import { run } from "../../core/compositions/run.js";

const read: () => number = () => 7;
export const value: number = run(read);
