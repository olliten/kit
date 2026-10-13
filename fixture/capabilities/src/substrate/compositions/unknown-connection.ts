import { externalUse } from "unsupported-library";
import { clock } from "../adapters/clock.js";

const read: () => number = () => clock();
export const value: number = externalUse(read);
