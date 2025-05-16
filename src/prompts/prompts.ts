/**
 * System and user prompts for the deep research pipeline
 */

import { WebSearchResult } from "../types/types";

// Synthesize information from search results
const SYNTHESIS_PROMPT_TEMPLATE = ({
  topic,
  searchResults,
}: {
  topic: string;
  searchResults: WebSearchResult[];
}) => `You are an expert research synthesizer. Your task is to analyze and synthesize information from multiple search results related to a main research topic.

${getCurrentDateContext()}

The topic for research is: ${topic}

Current Search Results:
${searchResults.map((result) => result.searchResults).join("\n")}

Based on the search results provided, you will:
1. Create a comprehensive research analysis that integrates all important findings
2. Identify key themes and patterns across the results
3. Generate insights that aren't explicitly stated in any single result
4. Identify any contradictions between sources and attempt to resolve them
5. Highlight knowledge gaps that still need to be addressed
6. Provide a confidence score (0-1) for the overall synthesis

Format your response as a valid JSON object with the following structure:
{
  "analysis": "A comprehensive analysis integrating all findings...",
  "keyThemes": ["Theme 1", "Theme 2", ...],
  "insights": ["Insight 1", "Insight 2", ...],
  "knowledgeGaps": ["Gap 1", "Gap 2", ...],
  "confidence": 0.85,
  "relatedQuestions": ["Question 1", "Question 2", ...]
}`;

const RESEARCH_PROMPT_TEMPLATE = ({ topic, pastReasoning, pastQueries }: { topic: string; pastReasoning?: string; pastQueries?: string[] }) => `
You are an AI research assistant. Your primary goal is to construct a comprehensive research plan and a set of effective search queries to thoroughly investigate a given topic.

The topic for research is: ${topic}

${pastReasoning ? `Past reasoning: ${pastReasoning}` : ""}

${pastQueries ? `Past queries: ${pastQueries.join(", ")}` : ""}

Please provide the following two components:

1.  **A Detailed Research Plan:**
    *   Clearly outline the overall research strategy and methodology you propose.
    *   Identify key areas, themes, or sub-topics that need to be investigated to ensure comprehensive coverage of the topic.
    *   Suggest the types of information, data, or sources (e.g., academic papers, official reports, news articles, expert opinions) that would be most valuable for this research.
    *   The plan should be logical, actionable, and designed for efficient information gathering.

2.  **A List of Focused Search Queries:**
    *   Generate a list of specific and targeted search queries.
    *   These queries should be optimized to yield relevant, high-quality, and diverse search results from search engines.
    *   The set of queries should collectively aim to cover the main aspects identified in your research plan.
    *   Ensure queries are distinct and avoid redundancy.

Your output should empower a researcher to systematically and effectively gather the necessary information to understand the topic in depth.
`;
const DECISION_MAKING_PROMPT = ({
  reasoning,
  totalOutputLength,
}: {
  reasoning: string;
  totalOutputLength: number;
}) => `
You are a decision-making assistant.

Your job is to decide whether the provided chain-of-thought reasoning gives enough context to start writing the final report of approximately ${totalOutputLength} words.

Chain of Thought:
"""${reasoning}"""

Instructions:
- If the reasoning is sufficient to cover all major sub-topics at the planned length, set “isComplete” to true.
- Otherwise set “isComplete” to false.
- In either case, provide a brief explanation in “reason” describing your judgement.
- **Output only** a JSON object with exactly these two keys and no extra text, for example:
  {
    "isComplete": true,
    "reason": "The reasoning covers all identified gaps and the target length is adequate."
  }
`;

const REASONING_SEARCH_RESULTS_PROMPT = ({
  topic,
  researchPlan,
  searchResults,
  allQueries,
}: {
  topic: string;
  researchPlan: string;
  searchResults: WebSearchResult[];
  allQueries: string[];
}) => `
You are an expert reasoning assistant. Given:

  • Topic to address:
    “${topic}”

  • Proposed research plan:
    """${researchPlan}"""

  • Search results obtained (array of { title, snippet, url }):
    ${JSON.stringify(searchResults, null, 2)}

  • All queries used:
    ${JSON.stringify(allQueries, null, 2)}

Your task is to evaluate whether this set of inputs collectively provides enough coverage and context to write a thorough, deep-dive research report on the topic. Think step by step and show your full chain-of-thought. Specifically:

1. **Decompose** the topic into its major sub-topics or dimensions.
2. **Map** each sub-topic to where (if at all) it is covered by the researchPlan, any of the searchResults, or the queries.
3. **Identify** gaps—sub-topics not covered or weakly supported.
4. **Assess** the quality, relevance, and diversity of the sources provided.
5. **Recommend** additional queries, source types, or angles needed to fill those gaps.
6. **Summarize** at the end with a JSON object containing:
   - sufficiency: “sufficient” or “insufficient”
   - missingAreas: [list of uncovered sub-topics]
   - suggestions: [list of concrete next queries or source types]

Begin by stating “Let me think through this step by step,” then proceed with your reasoning.  
`;

const EVALUATION_PROMPT = ({
  prompt,
  researchPlan,
  allQueries,
  resultsSummary,
}: {
  prompt: string;
  researchPlan: string;
  allQueries: string[];
  resultsSummary: string;
}) => {
  return `
    ${getCurrentDateContext()}
    You are an expert research planner. Your task is to analyze search results evaluate them and generate targeted follow-up questions to explore knowledge gaps or go deeper into interesting aspects.

    PROCESS:
    1. Identify ALL information explicitly requested in the original research goal
    2. Analyze what specific information has been successfully retrieved in the search results
    3. Identify ALL information gaps between what was requested and what was found
    4. For entity-specific gaps: Create targeted queries for each missing attribute of identified entities
    5. For general knowledge gaps: Create focused queries to find the missing conceptual information

    QUERY GENERATION RULES:
    - For missing entity attributes:
      * Create direct queries for each entity-attribute pair (e.g., "LeBron James height")
    - For general knowledge gaps:
      * Create focused queries addressing each conceptual gap (e.g., "criteria for ranking basketball players")
    - Construct queries to retrieve EXACTLY the missing information
    - Exclude information not required by the original research goal
    - Prioritize queries for the most critical missing information first
    
    FOLLOW-UP QUESTIONS CRITERIA:
    - Target specific knowledge gaps in current results
    - Focus on unexplored but relevant aspects
    - Be specific enough to yield useful information
    - Avoid repeating already covered information
    - Phrase as clear, direct questions

    OUTPUT FORMAT:
    First, briefly state:
    1. What specific information was found
    2. What specific information is still missing
    3. What type of knowledge gaps exist (entity-specific or general knowledge)

    Then provide up to 5 targeted queries that directly address the identified gaps, ordered by importance. Please consider that you
    need to generate queries that tackle a single goal at a time (searching for A AND B will return bad results). Be specific!

    <Research Topic>${prompt}</Research Topic>

    <Research Plan>${researchPlan}</Research Plan>

    <Search Queries Used>${allQueries.join(", ")}</Search Queries Used>
    
    <Current Search Results Summary>${resultsSummary}</Current Search Results Summary>
    
    Based on the above information, evaluate if we have sufficient research coverage or need additional queries.
    Identify which aspects of the research plan have been covered and which areas still need investigation.
    
    Your response MUST be formatted exactly as follows:
    
    IS_COMPLETE: [true or false]
    REASON: [Your detailed reasoning for why the research is complete or not]
    QUERIES: [If IS_COMPLETE is false, provide a JSON array of additional search queries like ["query1", "query2"]. If complete, use empty array []]
    
    Please ensure there are no thinking tags, reasoning sections, or other markup in your response.`;
};
// ^^ reasoning should be in the same model
// ^^ put is_complete and queries into another model
const FINAL_REPORT_PROMPT = ({
  topic,
  latestResearchPlan,
  sources,
  queries,
  latestReasoning,
  maxOutputTokens,
  continuationMarker,
  targetOutputLength,
  currentReport,
  currentOutputLength,
}: {
  topic: string;
  latestResearchPlan: string;
  sources: WebSearchResult[];
  queries: string[];
  latestReasoning: string;
  maxOutputTokens: number;
  continuationMarker: string;
  targetOutputLength: number;
  currentReport?: string;
  currentOutputLength?: number;
}) => {
  const systemPrompt = `You are a world-class research analyst and writer. Your task is to produce a single, cohesive deep research article based on multiple research findings related to a main research topic.
        
        You will:
        1. Introduce the topic—outlining scope, importance, and objectives.
        2. Synthesize all intermediate analyses, weaving them into a structured narrative.
        3. Identify and group the key themes and patterns that emerge across sources.
        4. Highlight novel insights your analysis uncovers—points not explicitly stated in any one source.
        5. Note contradictions or conflicts in the literature, resolving them or clearly framing open debates.
        6. Pinpoint remaining knowledge gaps and recommend avenues for further inquiry.
        7. Conclude with a concise summary of findings and practical or theoretical implications.
        8. Cite every factual claim or statistic with in-text references (e.g. "[1](https://www.source.com)", "[2](https://www.source2.com)") and append a numbered bibliography.
        9. If you cannot complete the full report in this response, **YOU MUST** append the continuation marker: ${continuationMarker}

        If there is an existing draft or “Current Report,” seamlessly continue from it—preserve its content and structure, and build upon it rather than starting over.
        `;

  const userPrompt = `Main Research Topic(s):
        ${topic}
        
        CRITICAL REQUIREMENT: Your response MUST be at least ${targetOutputLength} tokens long. This is not a suggestion but a strict requirement. Please provide extensive detail, examples, analysis, and elaboration on all aspects of the topic to reach this minimum length. Do not summarize or be concise.
        
        ${maxOutputTokens ? `Your response must not exceed ${maxOutputTokens} tokens.` : ""}
        
        Latest Research Plan:
        ${latestResearchPlan}

        Latest Reasoning:
        ${latestReasoning}

        Search Queries:
        ${queries.join("\n")}

        Search Results:
        ${sources.map((result) => result.searchResults).join("\n")}

        Current Report:
        ${currentReport}

        Current Output Length:
        ${currentOutputLength}
        
        Please create a final comprehensive research article according to the instructions.`;

  return {
    systemPrompt,
    userPrompt,
  };
};
/**
 *
 *
 * Core prompt function that adds current date information to all prompts
 * This ensures all models have the correct temporal context for research
 */
const getCurrentDateContext = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // JavaScript months are 0-indexed
  const day = now.getDate();
  const monthName = now.toLocaleString("default", { month: "long" });

  return `Current date is ${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")} (${monthName} ${day}, ${year}).
When searching for recent information, prioritize results from the current year (${year}) and month (${monthName} ${year}).
For queries about recent developments, include the current year (${year}) in your search terms.
When ranking search results, consider recency as a factor - newer information is generally more relevant for current topics.`;
};

// Export all prompts together with date context
export const PROMPTS = {
  synthesis: SYNTHESIS_PROMPT_TEMPLATE,
  evaluation: EVALUATION_PROMPT,
  // evaluationParse: `${EVALUATION_PARSE_PROMPT_TEMPLATE}`,
  finalReport: FINAL_REPORT_PROMPT,
  research: RESEARCH_PROMPT_TEMPLATE,
  reasoningSearchResults: REASONING_SEARCH_RESULTS_PROMPT,
  decisionMaking: DECISION_MAKING_PROMPT,
};
