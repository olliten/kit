import { run } from "../../core/compositions/run.js";
import { clock } from "../adapters/clock.js";

const read: () => number = () => clock();
export const value: number = run(read);
