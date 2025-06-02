import { ResearchSource, WebSearchResult } from "@/types/types";

export class ContentCleaner {
  /**
   * Clean and normalize content from a research source
   */
  public static cleanContent(source: ResearchSource): ResearchSource {
    // Clean the content if it exists
    const cleanedContent = source.content ? this.contentPipeline(source.content) : undefined;

    // Clean snippets if they exist
    const cleanedSnippets = source.snippets ? source.snippets.map((snippet) => this.contentPipeline(snippet)) : undefined;

    return {
      ...source,
      content: cleanedContent,
      snippets: cleanedSnippets,
    };
  }

  /**
   * Run content through the regular cleaning pipeline
   */
  private static contentPipeline(content: string): string {
    return this.contentSteps.reduce((text, step) => step(text), content);
  }

  /**
   * Steps for cleaning regular content
   */
  private static contentSteps: Array<(text: string) => string> = [
    // Remove HTML tags
    (text: string) => text.replace(/<[^>]*>/g, " "),

    // Remove CSS class definitions and inline styles
    (text: string) => text.replace(/\.[A-Za-z][\w-]*\s*\{[^}]*\}/g, ""),

    // Remove MathJax and other CSS class patterns
    (text: string) => text.replace(/\.(MJX|mjx)[-\w]*\s*\{[^}]*\}/g, ""),

    // Remove @font-face declarations
    (text: string) => text.replace(/@font-face\s*\{[^}]*\}/g, ""),

    // Remove CSS properties commonly used in MathJax
    (text: string) =>
      text.replace(
        /\b(display|position|font-family|src|font-weight|font-style|margin|padding|border|width|height|min-width|max-width|text-align|line-height|box-sizing):[^;}]*(;|$)/g,
        ""
      ),

    // Remove content that looks like CSS rule sets
    (text: string) => text.replace(/\w+(\.\w+)*\s*\{[^{}]*\}/g, ""),

    // Remove URL references in CSS
    (text: string) => text.replace(/url\([^)]*\)/g, ""),

    // Clean up references to MathJax inline elements
    (text: string) => text.replace(/\.mjx-chtml\s*\{[^}]*\}/g, ""),
    (text: string) => text.replace(/\.mjx-[-\w]+/g, ""),

    // Normalize whitespace
    (text: string) => text.replace(/\s+/g, " "),

    // Remove special characters but keep meaningful punctuation
    (text: string) => text.replace(/[^\w\s.,!?;:()"'-]/g, " "),

    // Normalize quotes
    (text: string) => text.replace(/[""]/g, '"').replace(/['']/g, "'"),

    // Fix common typographical issues
    (text: string) =>
      text
        .replace(/(\d+)([a-zA-Z])/g, "$1 $2") // Add space between numbers and letters
        .replace(/([a-zA-Z])(\d+)/g, "$1 $2") // Add space between letters and numbers
        .replace(/\.{3,}/g, "...") // Normalize ellipsis
        .replace(/\s*-\s*/g, " - "), // Normalize dashes

    // Remove URLs
    (text: string) => text.replace(/https?:\/\/\S+/g, ""),

    // Fix sentence spacing
    (text: string) => text.replace(/([.!?])\s*([A-Z])/g, "$1 $2"),

    // Additional cleanup for MathJax remnants
    (text: string) => text.replace(/l\.mjx-chtml/g, ""),
    (text: string) => text.replace(/X\.mjx-chtml/g, ""),
    (text: string) => text.replace(/format\(\'woff\'\)/g, ""),
    (text: string) => text.replace(/format\(\'opentype\'\)/g, ""),

    // Remove empty brackets
    (text: string) => text.replace(/\{\s*\}/g, ""),

    // Clean up multiple consecutive spaces created by the removals
    (text: string) => text.replace(/\s{2,}/g, " "),

    // Trim extra whitespace
    (text: string) => text.trim(),

    // Ensure proper sentence endings
    (text: string) => {
      const lastChar = text.slice(-1);
      if (!".,!?".includes(lastChar) && text.length > 0) {
        return text + ".";
      }
      return text;
    },
  ];
}

/**
 * Deduplicate search results
 *
 * @param sources - The search results (url, query, context, etc) from JigsawStack
 * @returns The deduplicated search results
 */
export const deduplicateSearchResults = ({ sources }: { sources: WebSearchResult[] }): WebSearchResult[] => {
  const urlMap = new Map<string, boolean>();

  return sources.map((result) => {
    return {
      query: result.query,
      context: result.context,
      searchResults: {
        results: result.searchResults.results
          .filter((item) => {
            // Skip if we've seen this URL before
            if (urlMap.has(item.url)) {
              return false;
            }
            // Mark this URL as seen
            urlMap.set(item.url, true);
            return true;
          })
          .map((item) => {
            return {
              ...item,
            };
          }),
      },
    };
  });
};

/**
 * Map search results to numbers
 *
 * @param sources - The search results (url, query, context, etc) from JigsawStack
 * @returns The search results with numbers
 */
export const mapSearchResultsToNumbers = ({ sources }: { sources: WebSearchResult[] }): WebSearchResult[] => {
  const urlMap = new Map<string, number>();
  let currentNumber = 1;

  return sources.map((result) => {
    return {
      query: result.query,
      context: result.context || "",
      searchResults: {
        // ai_overview: result.searchResults.ai_overview,
        results: result.searchResults.results.map((item) => {
          // If URL hasn't been seen before, assign it a new number
          if (!urlMap.has(item.url)) {
            urlMap.set(item.url, currentNumber++);
          }

          return {
            ...item,
            referenceNumber: urlMap.get(item.url) || 0,
          };
        }),
      },
    };
  });
};
