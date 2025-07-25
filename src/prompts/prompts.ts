import { DeepResearchConfig, ResearchSource, WebSearchResult } from "@/types/types";
import { z } from "zod";

const CONTEXT_GENERATION_PROMPT = ({
  prompt,
  queries,
  research_sources,
}: { prompt: string; queries: string[]; research_sources: ResearchSource[] }) =>
  `
You are a world-class context generator.
Your task is to generate a context overview for the following queries and sources that relates to the main prompt:
Extract all the information from the sources that is relevant to the main prompt.

Main Prompt:
${prompt}

Sub-Queries and Sources:
${queries
  ?.map((q) => {
    const sourcesForQuery = research_sources?.filter((s) => s.url && s.url.length > 0);
    if (sourcesForQuery && sourcesForQuery.length > 0) {
      return `**${q}**\n${sourcesForQuery
        .map(
          (r) => `   
    [${r.reference_number}] ${r.title || "No title"} (${r.url})\n      
    Content and Snippets: ${r.content ? r.content : r.snippets?.join("\n")}`
        )
        .join("\n")}`;
    }
    return `**${q}** (No sources found)`;
  })
  .join("\n\n")}
`.trim();

const RESEARCH_PROMPT_TEMPLATE = ({
  prompt,
  reasoning,
  queries,
  sources,
  config,
}: { prompt: string; reasoning?: string; queries?: string[]; sources?: WebSearchResult[]; config: DeepResearchConfig }) => {
  const systemPrompt =
    `You are a world-class research planner. Your primary goal is to construct a comprehensive research plan and a set of effective search queries to thoroughly investigate the given prompt.

  INSTRUCTIONS:
  1. A Detailed Research Plan:
      - Clearly outline the overall research strategy and methodology you propose.
      - Identify key areas, themes, or sub-topics that need to be investigated to ensure comprehensive coverage of the prompt.
      - Suggest the types of information, data, or sources (e.g., academic papers, official reports, news articles, expert opinions) that would be most valuable for this research.
      - The plan should be logical, actionable, and designed for efficient information gathering.
  2. A List of Focused Search Queries:
      - Generate a list of specific and targeted search queries.
      - These queries should be optimized to yield relevant, high-quality, and diverse search results from search engines.
      - The set of queries should collectively aim to cover the main aspects identified in your research plan.
      - Ensure queries are distinct and avoid redundancy.
  3. Generate how deep the research should be:
      - Generate a number to determine how deep the research should be to fully explore this prompt
  4. Generate how broad the research should be:
      - Generate a number to determine how broad the research should be to fully explore this prompt

      Output in the given JSON schema.
  `.trim();

  const userPrompt = `
${reasoning ? `Reasoning: ${reasoning}` : ""}

${
  queries
    ? `
Sub-Queries and Sources previously generated:
${queries
  .map((q) => {
    const sourcesForQuery = sources?.find((s) => s.query === q);
    if (sourcesForQuery && sourcesForQuery.search_results.results.length > 0) {
      return `**${q}**\n${sourcesForQuery.search_results.results
        .map(
          (r) => `   
    [${r.reference_number}] ${r.title || "No title"} (${r.url})\n      
    Content and Snippets: ${r.content ? r.content : r.snippets?.join("\n")}`
        )
        .join("\n")}`;
    }
    return `**${q}** (No sources found)`;
  })
  .join("\n")}`
    : ""
}
  
User Prompt: ${prompt}
`.trim();

  const schema = z.object({
    subQueries: z.array(z.string()).min(1).max(config.max_breadth).describe("An array of high-quality, non-redundant search queries (min 1, max N) that together provide comprehensive research coverage for the user prompt"),
    researchPlan: z.string().describe("A detailed plan explaining the research approach and methodology"),
    depth: z.number().min(1).max(config.max_depth).describe("A number representing the depth of the research"),
    breadth: z.number().min(1).max(config.max_breadth).describe("A number representing the breadth of the research"),
  });

  return {
    system: systemPrompt,
    user: userPrompt,
    schema,
  };
};

const DECISION_MAKING_PROMPT = ({
  prompt,
  reasoning,
  queries,
  sources,
  researchPlan,
}: {
  reasoning: string;
  prompt: string;
  queries: string[];
  sources: WebSearchResult[];
  researchPlan: string;
}) => {
  const systemPrompt = `
You are a world-class analyst. Your primary purpose is to help decide if the data provided is sufficient to complete the given prompt.

Current datetime is: ${new Date().toISOString()}

INSTRUCTIONS:
- If the reasoning is sufficient to answer the prompt set "isComplete" to true.
- In either case, provide a brief explanation in "reason" describing your judgement.

Response in the given JSON schema.
`.trim();

  const userPrompt = `
Research Plan:
"${researchPlan}"

Sub-Queries and Sources previously generated:
${queries
  .map((q) => {
    const sourcesForQuery = sources?.find((s) => s.query === q);
    if (sourcesForQuery && sourcesForQuery.search_results.results.length > 0) {
      return `**${q}**\n${sourcesForQuery.search_results.results
        .map(
          (r) => `   
    [${r.reference_number}] ${r.title || "No title"} (${r.url})\n      
    Content and Snippets: ${r.content ? r.content : r.snippets?.join("\n")}`
        )
        .join("\n")}`;
    }
    return `**${q}** (No sources found)`;
  })
  .join("\n")}

Reasoning generated previously: "${reasoning}"

Prompt: "${prompt}"
`.trim();

  const schema = z.object({
    isComplete: z.boolean().describe("If the reasoning is sufficient to answer the main prompt set to true."),
    reason: z.string().describe("The reason for the decision"),
  });

  return {
    system: systemPrompt,
    user: userPrompt,
    schema,
  };
};

const REASONING_SEARCH_RESULTS_PROMPT = ({
  prompt,
  researchPlan,
  queries,
  sources,
}: {
  prompt: string;
  researchPlan: string;
  queries: string[];
  sources: WebSearchResult[];
}) => {
  const systemPrompt = ``.trim();

  const userPrompt = `
Proposed research plan: 
"${researchPlan}"

Context for each query:
${queries
  ?.map((q) => {
    const sourcesForQuery = sources?.find((s) => s.query === q);
    if (sourcesForQuery) {
      return `**Query: ${q}**\n
    Context: ${sourcesForQuery.context}`;
    } else {
      return `**Query: ${q}**\n
    Context: No context found`;
    }
  })
  .join("\n")}

Prompt: "${prompt}"
`.trim();

  return {
    system: systemPrompt,
    user: userPrompt,
  };
};

const FINAL_REPORT_PROMPT = ({
  prompt,
  sources,
  targetOutputTokens,
  researchPlan,
  reasoning,
  queries,
  phase,
  currentReport,
}: {
  prompt: string;
  sources: WebSearchResult[];
  targetOutputTokens?: number;
  researchPlan: string;
  reasoning: string;
  queries: string[];
  currentReport: string;
  phase: "initial" | "continuation";
}) => {
  const targetChars = targetOutputTokens ? targetOutputTokens * 3 : undefined;
  const remaining = targetChars ? Math.max(targetChars - currentReport.length, 0) : undefined;
  const atTarget = targetChars ? currentReport.length >= targetChars : undefined;

  const systemPrompt = `
  You are a world-class analyst.
  Your primary purpose is to help users answer their prompt. 

  GENERAL GUIDELINES:
    - If you are about to reach your output token limit, ensure you properly close all JSON objects and strings to prevent parsing errors.
    - Only use the sources provided in the context.
    - Cite every factual claim or statistic with in-text references using the reference numbers by the sources provided (e.g. "[1]").
    - **Never repeat a heading that is already present in the Existing Draft.**
    - When writing mathematical equations, always use single dollar sign syntax ($...$) for inline equations 
      and double dollar signs ($$...$$) for block equations. Do not use \(...\) or \[...\] delimiters.

  INSTRUCTIONS:
    - generate in the
    - Make sure your report is addressing the prompt.
    - Make sure your report is comprehensive and covers all the sub-topics.
    - Make sure your report is well-researched and well-cited.
    - Make sure your report is well-written and well-structured.
    - Make sure your report is well-organized and well-formatted.
  `;

  // Determine instructions based on phase
  let phaseInstructions = "";
  switch (phase) {
    case "initial":
      phaseInstructions = `
        Do not generate a reference or conclusion section. Return phase as "continuation"
      `;
      break;
    case "continuation":
      if (atTarget === false) {
        phaseInstructions = `
          Generate a continuation of the report. No need to include the initial report.
          ${remaining ? `You still need ≈${remaining.toLocaleString()} characters.` : ""}
          Do not generate a reference or conclusion section. Return phase as "continuation"
        `;
      } else {
        phaseInstructions = `
          - This is your FINAL response for this question.
          - If the provided sources are insufficient, give your best definitive answer.
          - YOU MUST conclude your answer now, regardless of whether you feel it's complete.

          Return phase as "done"
        `;
      }
      break;
  }

  const userPrompt = `
  ${
    targetOutputTokens
      ? `Target length:
    ≈ ${(targetOutputTokens * 3).toLocaleString()} characters (${targetOutputTokens} tokens ×3)`
      : ""
  }

  CONTEXT:
    Latest Research Plan:
    ${researchPlan}

    Latest Reasoning Snapshot:
    ${reasoning}

    Sub-Queries and Sources:
    ${queries
      ?.map((q) => {
        const sourcesForQuery = sources?.find((s) => s.query === q);
        if (sourcesForQuery && sourcesForQuery.search_results.results.length > 0) {
          return `**${q}**\n${sourcesForQuery.search_results.results
            .map(
              (r) => `   
        [${r.reference_number}] ${r.title || "No title"} (${r.url})\n      
        Content and Snippets: ${r.content ? r.content : r.snippets?.join("\n")}`
            )
            .join("\n")}`;
        }
        return `**${q}** (No sources found)`;
      })
      .join("\n\n")}


    ${currentReport ? `Current Draft:\n${currentReport}` : ""}
    ${phaseInstructions}\n

  Prompt:
  "${prompt}"
  `.trim();

  const schema = z.object({
    text: z.string().describe("The final report"),
    phase: z.enum(["initial", "continuation", "done"]).describe("The phase of the report"),
  });

  return {
    system: systemPrompt,
    user: userPrompt,
    schema,
  };
};

// Export all prompts together with date context
export const PROMPTS = {
  research: RESEARCH_PROMPT_TEMPLATE,
  reasoningSearchResults: REASONING_SEARCH_RESULTS_PROMPT,
  decisionMaking: DECISION_MAKING_PROMPT,
  finalReport: FINAL_REPORT_PROMPT,
  contextGeneration: CONTEXT_GENERATION_PROMPT,
};
