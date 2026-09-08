import { z } from 'zod';

export const serverInfoOutputSchema = z.object({
  name: z.string(),
  version: z.string(),
  environment: z.string(),
  status: z.literal('ready'),
  requestId: z.string()
});

export const textAnalysisOutputSchema = z.object({
  characterCount: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  preview: z.string().optional(),
  requestId: z.string()
});
