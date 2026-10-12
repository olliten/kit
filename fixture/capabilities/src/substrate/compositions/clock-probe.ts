import { run } from "../../core/compositions/run.js";
import { clock } from "../primitives/clock.js";

const read: () => number = () => clock();
export const value: number = run(read);
