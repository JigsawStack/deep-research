import { DeepResearchConfig, DeepResearchParams, WebSearchResult } from "@/types/types";
import AIProvider from "@provider/aiProvider";
import { DEFAULT_CONFIG } from "./config/defaults";
import { decisionMaking, generateFinalReport, generateResearchPlan, reasoningSearchResults } from "./process";
import { WebSearchProvider } from "./provider/webSearch";
import { Logger, logger } from "./utils/logger";
import { mapSearchResultsToNumbers } from "./utils/utils";

export class DeepResearch {
  public config: DeepResearchConfig;
  public prompt: string = "";
  public finalReport: string = "";
  public tokenUsage: {
    research_tokens: number;
    reasoning_tokens: number;
    report_tokens: number;
    decision_tokens: number;
    total_tokens: number;
  } = { research_tokens: 0, reasoning_tokens: 0, report_tokens: 0, decision_tokens: 0, total_tokens: 0 };

  public researchPlan: string = "";
  public reasoning: string = "";
  public decision: { isComplete: boolean; reason: string } = { isComplete: false, reason: "" };
  public logger = Logger.getInstance();

  public queries: string[] = [];
  public sources: WebSearchResult[] = [];
  public aiProvider: AIProvider;
  private webSearchProvider: WebSearchProvider;

  constructor(config: DeepResearchParams) {
    this.config = this.validateConfig(config) as DeepResearchConfig;

    if (this.config.logging && this.config.logging.enabled !== undefined) {
      this.logger.setEnabled(this.config.logging.enabled);
    }

    this.webSearchProvider = WebSearchProvider.getInstance(this.config);

    this.aiProvider = AIProvider.getInstance({
      OPENAI_API_KEY: this.config.OPENAI_API_KEY,
      DEEPINFRA_API_KEY: this.config.DEEPINFRA_API_KEY,
      defaultModel: this.config.models?.default,
      reasoningModel: this.config.models?.reasoning,
      outputModel: this.config.models?.output,
    });
  }

  /**
   * Validate the configuration
   *
   * @param config - The configuration for the DeepResearch instance
   * @returns The validated configuration (merged with defaults)
   */
  public validateConfig(config: DeepResearchParams) {
    // maxOutputTokens must be greater than targetOutputLength
    if (config.max_output_tokens && config.target_output_tokens && config.max_output_tokens < config.target_output_tokens) {
      throw new Error("maxOutputChars must be greater than targetOutputChars");
    }

    return {
      config: {
        ...DEFAULT_CONFIG,
        ...(config || {}),
      },
      max_output_tokens: config.max_output_tokens || DEFAULT_CONFIG.max_output_tokens,
      target_output_tokens: config.target_output_tokens,
      max_depth: config.max_depth || DEFAULT_CONFIG.max_depth,
      max_breadth: config.max_breadth || DEFAULT_CONFIG.max_breadth,
      JIGSAW_API_KEY:
        config.JIGSAW_API_KEY ||
        process.env.JIGSAW_API_KEY ||
        (config.web_search
          ? null
          : (() => {
              throw new Error("JIGSAW_API_KEY must be provided in config");
            })()),
      OPENAI_API_KEY:
        config.OPENAI_API_KEY ||
        process.env.OPENAI_API_KEY ||
        (config.models?.default && config.models?.output
          ? null
          : (() => {
              throw new Error("Either OPENAI_API_KEY or models.default and models.output must be provided in config");
            })()),
      DEEPINFRA_API_KEY:
        config.DEEPINFRA_API_KEY ||
        process.env.DEEPINFRA_API_KEY ||
        (config.models?.reasoning
          ? null
          : (() => {
              throw new Error("DeepInfra API key must be provided in config");
            })()),
      logging: {
        ...DEFAULT_CONFIG.logging,
        ...(config.logging || {}),
      },
      models: {
        ...(config.models || {}),
      },
      web_search: config.web_search,
    } as DeepResearchConfig;
  }

  /**
   * Generate a research report
   *
   * @param prompt - The prompt of the research
   * @returns The research report
   */
  public async generate(prompt: string) {
    logger.log(`Running research with prompt: ${prompt}`);
    this.prompt = prompt;
    let iteration = 0;

    do {
      iteration++;

      logger.log(`[Step 1] Generating research plan... at ${iteration}`);

      const { subQueries, researchPlan, depth, breadth, tokenUsage } = await generateResearchPlan({
        aiProvider: this.aiProvider,
        prompt: this.prompt,
        reasoning: this.reasoning,
        queries: this.queries,
        sources: this.sources,
        config: this.config,
      });

      this.queries = [...(this.queries || []), ...subQueries];
      this.researchPlan = researchPlan;
      this.config.max_depth = depth;
      this.config.max_breadth = breadth;
      this.tokenUsage.research_tokens = tokenUsage.totalTokens;

      logger.log(`Research plan: ${this.researchPlan}`);
      logger.log(`Research queries: ${this.queries.join("\n")}`);
      logger.log(`Research depth and breadth: ${this.config.max_depth} ${this.config.max_breadth}`);

      // step 2: fire web searches
      logger.log(`[Step 2] Running initial web searches with ${this.queries.length} queries...`);

      const searchResults = await this.webSearchProvider.searchAndGenerateContext({
        queries: this.queries,
        prompt: this.prompt,
        aiProvider: this.aiProvider,
        sources: this.sources,
      });

      this.sources = searchResults;

      // step 3: reasoning about the search results
      logger.log(`[Step 3] Reasoning about the search results...`);
      const reasoning = await reasoningSearchResults({
        prompt: this.prompt,
        researchPlan: this.researchPlan,
        sources: this.sources,
        queries: this.queries,
        aiProvider: this.aiProvider,
      });
      this.reasoning = reasoning.reasoning;
      this.tokenUsage.reasoning_tokens = reasoning.usage.totalTokens;

      logger.log(`Reasoning: ${reasoning}`);

      // step 4: decision making
      logger.log(`[Step 4] Decision making...`);
      const { decision, usage } = await decisionMaking({
        reasoning: this.reasoning,
        prompt: this.prompt,
        queries: this.queries,
        sources: this.sources,
        researchPlan: this.researchPlan,
        aiProvider: this.aiProvider,
      });

      this.decision = decision.object;
      this.tokenUsage.decision_tokens = usage.totalTokens;

      logger.log(`Decision making: ${this.decision.isComplete} ${this.decision.reason}`);
    } while (!this.decision.isComplete && iteration < this.config.max_depth);

    // map the sources to numbers for sources
    this.sources = mapSearchResultsToNumbers({ sources: this.sources });

    // step 5: generating report
    logger.log(`[Step 5] Generating report...`);

    const {
      report,
      bibliography,
      tokenUsage: reportTokenUsage,
    } = await generateFinalReport({
      sources: this.sources,
      prompt: this.prompt,
      targetOutputTokens: this.config.target_output_tokens,
      maxOutputTokens: this.config.max_output_tokens,
      aiProvider: this.aiProvider,
      reasoning: this.reasoning,
      researchPlan: this.researchPlan,
      queries: this.queries,
    });

    this.tokenUsage.report_tokens = reportTokenUsage;
    this.tokenUsage.total_tokens =
      this.tokenUsage.research_tokens + this.tokenUsage.reasoning_tokens + this.tokenUsage.decision_tokens + this.tokenUsage.report_tokens;

    return {
      status: "success",
      data: {
        text: report,
        bibliography,
        metadata: {
          prompt: this.prompt,
          reasoning: this.reasoning,
          research_plan: this.researchPlan,
          queries: this.queries,
          sources: this.sources,
          // image_urls: this.sources
          //   .map((source) => source.image_urls)
          //   .flat()
          //   .filter(Boolean),
          // links: this.sources
          //   .map((source) => source.links)
          //   .flat()
          //   .filter(Boolean),
          // geo_results: this.sources
          //   .map((source) => source.geo_results)
          //   .flat()
          //   .filter(Boolean),
        },
      },
      _usage: this.tokenUsage,
    };
  }
}

/**
 * Create a new DeepResearch instance
 *
 * @param config - The configuration for the DeepResearch instance
 * @returns A new DeepResearch instance
 */
export const createDeepResearch = (config: Partial<DeepResearchConfig>) => {
  return new DeepResearch(config);
};
