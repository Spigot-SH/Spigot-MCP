import { z } from 'zod';

export function createTextAnalysisInputSchema(maxInputChars: number) {
  return z.object({
    text: z
      .string()
      .min(1, 'text must not be empty')
      .max(maxInputChars, 'text exceeds the maximum length'),
    includePreview: z.boolean().default(false)
  });
}
