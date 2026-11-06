import { customAlphabet } from 'nanoid';
const alphabet = '346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrtwxyz';
export const newId = customAlphabet(alphabet, 10);