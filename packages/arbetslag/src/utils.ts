import { customAlphabet } from "nanoid/non-secure";
const ALPHABET = "346789ABCDEFGHJKLMNPQRTUWXY";

// biome-ignore lint/style/useNamingConvention: exported as a function
export const nanoid: () => string = customAlphabet(ALPHABET, 12);
