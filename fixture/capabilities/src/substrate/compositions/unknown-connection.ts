import { externalUse } from "unsupported-library";
import { clock } from "../primitives/clock.js";

const read: () => number = () => clock();
export const value: number = externalUse(read);
