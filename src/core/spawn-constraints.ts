import { SpawnConstraints } from '../types';
import { z } from 'zod';

export class SpawnConstraintsValidator {
  static validate(constraints: SpawnConstraints): void {
    const schema = z.object({
      maxCount: z.number().int().nonnegative(),
      maxDepth: z.number().int().nonnegative(),
      allowedTypes: z.array(z.string()).optional(),
    });

    schema.parse(constraints);
  }
}

export function validateSpawnConstraints(constraints: SpawnConstraints): void {
  SpawnConstraintsValidator.validate(constraints);
}
