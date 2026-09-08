import { describe, expect, it } from 'vitest';

import { TextAnalysisService } from './text-analysis.service.js';

describe('TextAnalysisService', () => {
  const service = new TextAnalysisService();

  it('calculates text metrics without normalizing returned content', () => {
    expect(service.analyze({ text: 'Hello  world\n🌍', includePreview: false })).toEqual({
      characterCount: 14,
      wordCount: 3,
      lineCount: 2
    });
  });

  it('includes a bounded preview only when requested', () => {
    const text = 'a'.repeat(200);
    expect(service.analyze({ text, includePreview: true })).toMatchObject({
      preview: 'a'.repeat(160)
    });
  });
});
