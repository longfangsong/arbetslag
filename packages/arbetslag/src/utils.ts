import { customAlphabet } from "nanoid/non-secure";
const ALPHABET = "346789ABCDEFGHJKLMNPQRTUWXY";

// biome-ignore lint/style/useNamingConvention: exported as a function
export const nanoid: () => string = customAlphabet(ALPHABET, 12);

export function idForType(type: string): string {
    return `${type}:${nanoid()}`;
}

export function type(id: string): string {
    return id.split(":", 2)[0]!;
}

export function unimplemented(): never {
    throw new Error("Not implemented");
}
