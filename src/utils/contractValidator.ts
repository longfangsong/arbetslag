import { z } from 'zod';

export class ContractValidator {
  /**
   * Validates that a given object conforms to a JSON schema.
   *
   * @param schema The Zod schema to validate against.
   * @param data The data to validate.
   * @returns The parsed data if valid.
   * @throws Error if validation fails.
   */
  static validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
    return schema.parse(data);
  }

  /**
   * Validates an entire object against a schema and returns a detailed error report if it fails.
   * Useful for debugging contract violations.
   */
  static validateAndReport(schema: z.ZodSchema, data: unknown, context: string): void {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errors = result.error.format();
      const errorString = JSON.stringify(errors, null, 2);
      throw new Error(`Contract violation in ${context}: ${errorString}`);
    }
  }
}
