import type { TextAnalysisInput, TextAnalysisResult } from '../types/tool.js';

const previewLength = 160;

export class TextAnalysisService {
  public analyze(input: TextAnalysisInput): TextAnalysisResult {
    const normalizedText = input.text.trim();
    const wordCount = normalizedText === '' ? 0 : normalizedText.split(/\s+/u).length;
    const lineCount = input.text === '' ? 0 : input.text.split(/\r?\n/u).length;

    return {
      characterCount: [...input.text].length,
      wordCount,
      lineCount,
      ...(input.includePreview ? { preview: input.text.slice(0, previewLength) } : {})
    };
  }
}
