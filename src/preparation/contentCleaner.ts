import { ResearchSource } from '../types';

export class ContentCleaner {
  /**
   * Clean and normalize content from a research source
   */
  public static cleanContent(source: ResearchSource): ResearchSource {
    const cleanedContent = this.contentPipeline(source.content);
    const cleanedOverview = this.markdownPipeline(source.ai_overview);
    const domain = this.extractDomain(source.url);
    const isAcademic = this.isAcademicSource(domain);

    return {
      ...source,
      content: cleanedContent,
      ai_overview: cleanedOverview,
      domain,
      isAcademic
    };
  }

  /**
   * Extract domain from URL
   */
  private static extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      // If URL parsing fails, try basic extraction
      const match = url.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:/\n]+)/im);
      return match ? match[1] : url;
    }
  }

  /**
   * Check if source is from an academic domain
   */
  private static isAcademicSource(domain: string): boolean {
    const academicDomains = [
      /\.edu$/,
      /\.ac\.[a-z]{2}$/,
      /scholar\.google\./,
      /science(direct)?\.com$/,
      /nature\.com$/,
      /researchgate\.net$/,
      /springer\.com$/,
      /ieee\.org$/,
      /jstor\.org$/,
      /pubmed\.ncbi\.nlm\.nih\.gov$/
    ];

    return academicDomains.some(pattern => pattern.test(domain));
  }

  /**
   * Run content through the regular cleaning pipeline
   */
  private static contentPipeline(content: string): string {
    return this.contentSteps.reduce((text, step) => step(text), content);
  }

  /**
   * Run markdown content through the markdown-preserving pipeline
   */
  private static markdownPipeline(content: string): string {
    return this.markdownSteps.reduce((text, step) => step(text), content);
  }

  /**
   * Steps for cleaning regular content
   */
  private static contentSteps: Array<(text: string) => string> = [
    // Remove HTML tags
    (text: string) => text.replace(/<[^>]*>/g, ' '),

    // Normalize whitespace
    (text: string) => text.replace(/\s+/g, ' '),

    // Remove special characters but keep meaningful punctuation
    (text: string) => text.replace(/[^\w\s.,!?;:()"'-]/g, ' '),

    // Normalize quotes
    (text: string) => text.replace(/[""]/g, '"').replace(/['']/g, "'"),

    // Fix common typographical issues
    (text: string) => text
      .replace(/(\d+)([a-zA-Z])/g, '$1 $2') // Add space between numbers and letters
      .replace(/([a-zA-Z])(\d+)/g, '$1 $2') // Add space between letters and numbers
      .replace(/\.{3,}/g, '...') // Normalize ellipsis
      .replace(/\s*-\s*/g, ' - '), // Normalize dashes

    // Remove URLs
    (text: string) => text.replace(/https?:\/\/\S+/g, ''),

    // Fix sentence spacing
    (text: string) => text.replace(/([.!?])\s*([A-Z])/g, '$1 $2'),

    // Trim extra whitespace
    (text: string) => text.trim(),

    // Ensure proper sentence endings
    (text: string) => {
      const lastChar = text.slice(-1);
      if (!'.,!?'.includes(lastChar)) {
        return text + '.';
      }
      return text;
    }
  ];

  /**
   * Steps for cleaning markdown content while preserving formatting
   */
  private static markdownSteps: Array<(text: string) => string> = [
    // Remove HTML tags but preserve markdown
    (text: string) => text.replace(/<[^>]*>/g, ' '),

    // Normalize markdown list items
    (text: string) => text.replace(/^\s*[-*+]\s+/gm, '* '),

    // Preserve markdown bold/italic
    (text: string) => text.replace(/\*\*|\*/g, match => match),

    // Normalize whitespace while preserving line breaks
    (text: string) => text.replace(/[ \t]+/g, ' '),

    // Fix markdown list spacing
    (text: string) => text.replace(/\n\n\*/g, '\n*'),

    // Trim extra whitespace while preserving markdown structure
    (text: string) => text.trim()
  ];
} 