import { DeepResearchConfig, DeepResearchParams, WebSearchResult } from "@/types/types";
import AIProvider from "@provider/aiProvider";
import { DEFAULT_BREADTH_CONFIG, DEFAULT_CONFIG, DEFAULT_DEPTH_CONFIG, DEFAULT_REPORT_CONFIG } from "./config/defaults";
import {
  decisionMaking,
  deduplicateSearchResults,
  generateFinalReport,
  generateResearchPlan,
  mapSearchResultsToNumbers,
  reasoningSearchResults,
} from "./process";
import { JigsawProvider } from "./provider/jigsaw";
import { Logger, logger } from "./utils/logger";

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
  private jigsaw: JigsawProvider;
  private iterationCount: number = 0;

  constructor(config: DeepResearchParams) {
    this.config = this.validateConfig(config) as DeepResearchConfig;

    if (this.config.logging && this.config.logging.enabled !== undefined) {
      this.logger.setEnabled(this.config.logging.enabled);
    }

    // Initialize AIProvider with API keys from config
    this.jigsaw = JigsawProvider.getInstance(this.config.JIGSAW_API_KEY);
    this.aiProvider = new AIProvider({
      OPENAI_API_KEY: this.config.OPENAI_API_KEY,
      GEMINI_API_KEY: this.config.GEMINI_API_KEY,
      DEEPINFRA_API_KEY: this.config.DEEPINFRA_API_KEY,
      defaultModel: this.config.models.default,
      reasoningModel: this.config.models.reasoning,
      outputModel: this.config.models.output,
    });

    this.initModels();
  }

  private initModels() {
    // Add models from config.models if available
    if (this.config.models) {
      Object.entries(this.config.models).forEach(([modelType, modelValue]) => {
        if (modelValue) {
          this.aiProvider.setModel(modelType, modelValue);
        }
      });
    }
  }

  /**
   * Validate the configuration
   *
   * @param config - The configuration for the DeepResearch instance
   * @returns The validated configuration (merged with defaults)
   */
  public validateConfig(config: DeepResearchParams) {
    // maxOutputTokens must be greater than targetOutputLength
    if (
      config.report &&
      config.report.maxOutputTokens &&
      config.report.targetOutputTokens &&
      config.report.maxOutputTokens < config.report.targetOutputTokens
    ) {
      throw new Error("maxOutputChars must be greater than targetOutputChars");
    }

    // Merge models carefully to handle both string and LanguageModelV1 instances
    const mergedModels = { ...DEFAULT_CONFIG.models, ...(config.models || {}) };

    if (config.models) {
      Object.entries(config.models).forEach(([key, value]) => {
        if (value !== undefined) {
          mergedModels[key] = value;
        }
      });
    }

    return {
      config: {
        ...DEFAULT_CONFIG,
        ...(config || {}),
      },
      depth: {
        ...DEFAULT_DEPTH_CONFIG,
        ...(config.depth || {}),
      },
      breadth: {
        ...DEFAULT_BREADTH_CONFIG,
        ...(config.breadth || {}),
      },
      report: {
        ...DEFAULT_REPORT_CONFIG,
        ...(config.report || {}),
      },
      models: mergedModels,
      JIGSAW_API_KEY:
        config.JIGSAW_API_KEY ||
        process.env.JIGSAW_API_KEY ||
        (() => {
          throw new Error("JIGSAW_API_KEY must be provided in config");
        })(),
      OPENAI_API_KEY:
        config.OPENAI_API_KEY ||
        process.env.OPENAI_API_KEY ||
        (() => {
          throw new Error("OpenAI API key must be provided in config");
        })(),
      GEMINI_API_KEY:
        config.GEMINI_API_KEY ||
        process.env.GEMINI_API_KEY ||
        (() => {
          throw new Error("Gemini API key must be provided in config");
        })(),
      DEEPINFRA_API_KEY:
        config.DEEPINFRA_API_KEY ||
        process.env.DEEPINFRA_API_KEY ||
        (() => {
          throw new Error("DeepInfra API key must be provided in config");
        })(),
      logging: {
        ...DEFAULT_CONFIG.logging,
        ...(config.logging || {}),
      },
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
      this.config.depth.maxDepth = depth;
      this.config.breadth.maxBreadth = breadth;
      this.tokenUsage.research_tokens = tokenUsage.totalTokens;

      logger.log(`Research plan: ${this.researchPlan}`);
      logger.log(`Research queries: ${this.queries.join("\n")}`);
      logger.log(`Research depth and breadth: ${this.config.depth.maxDepth} ${this.config.breadth.maxBreadth}`);

      // step 2: fire web searches
      logger.log(`[Step 2] Running initial web searches with ${this.queries.length} queries...`);

      const initialSearchResults = await this.jigsaw.searchAndGenerateContext(this.queries, this.prompt, this.aiProvider);

      // step 2.5: deduplicate results
      logger.log(`Received ${initialSearchResults.length} initial search results`);
      logger.log(`[Step 2.5] Deduplicating search results...`);

      this.sources = [...this.sources, ...initialSearchResults];

      const deduplicatedResults = deduplicateSearchResults({ sources: this.sources });

      // save it to the class for later use
      this.sources = deduplicatedResults;
      logger.log("DEDUPLICATED RESULTS", deduplicatedResults);

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
    } while (!this.decision.isComplete && iteration < this.config.depth.maxDepth);

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
      targetOutputTokens: this.config.report.targetOutputTokens,
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
          iterationCount: this.iterationCount,
          completionStatus: this.decision.isComplete,
          reasoning: this.reasoning,
          researchPlan: this.researchPlan,
          queries: this.queries,
          sources: this.sources,
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
