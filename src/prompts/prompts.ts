/**
 * System and user prompts for the deep research pipeline
 */

import { WebSearchResult } from "../types/types";

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
  targetOutputTokens,
}: {
  reasoning: string;
  targetOutputTokens: number;
}) => `
You are a decision-making assistant.

Your job is to decide whether the provided chain-of-thought reasoning gives enough context to start writing the 
final report of approximately ${targetOutputTokens * 5} characters.

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

    ${getCurrentDateContext()}

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

/** Builds the prompt for each report-generation round */
const FINAL_REPORT_PROMPT = ({
  topic,
  latestResearchPlan,
  sources,
  queries,
  latestReasoning,
  maxOutputTokens,
  continuationMarker,
  targetOutputTokens,
  currentReport = "",
  currentOutputLength = 0,
}: {
  topic: string;
  latestResearchPlan: string;
  sources: WebSearchResult[];
  queries: string[];
  latestReasoning: string;
  maxOutputTokens: number;
  continuationMarker: string;
  targetOutputTokens: number;
  currentReport?: string;
  currentOutputLength?: number;
}) => {
  /* ────────────────────────────────────────────────── */
  /* 1 .  dynamic knobs                                */
  /* ────────────────────────────────────────────────── */
  const FINAL_MARGIN_CHARS = 500; // ⇠ when draft is this close, allow wrap-up
  const targetChars = targetOutputTokens * 5;
  const remainingChars = Math.max(targetChars - currentOutputLength, 0);
  const mustStayInBody = remainingChars > FINAL_MARGIN_CHARS;

  /* ────────────────────────────────────────────────── */
  /* 2 .  system prompt                                 */
  /* ────────────────────────────────────────────────── */
  const systemPrompt = `
You are a world-class research analyst and writer. Produce a single, cohesive deep-research article.

1. Introduce the topic—outlining scope, importance, and objectives.  
2. Synthesize intermediate analyses into a structured narrative.  
3. Identify and group key themes and patterns across sources.  
4. Highlight novel insights not explicitly stated in any single source.  
5. Note contradictions or conflicts, resolving them or framing open debates.  
6. **Write the “Conclusion” and “Bibliography” only once, at the very end.**  
7. Cite every factual claim or statistic with in-text references (e.g. “[1](https://source.com)”) and append a numbered bibliography.  
8. **Never repeat a heading that is already present in the Existing Draft.**

**Continuation rule — mandatory:**  
If you cannot finish the report in this response, you must append exactly:  
${continuationMarker}

**Draft-continuity rule:**  
If a draft exists, continue seamlessly; expand it rather than restarting.
`.trim();

  /* ────────────────────────────────────────────────── */
  /* 3 .  user prompt                                   */
  /* ────────────────────────────────────────────────── */
  const userPrompt = `
Main Research Topic:
${topic}

Existing Draft (≈${currentOutputLength} chars):
${currentReport}

Latest Research Plan:
${latestResearchPlan}

Latest Reasoning:
${latestReasoning}

Sub-Queries:
${queries.map((q) => `- ${q}`).join("\n")}

Search Results Overview:
${sources
  .map((r, i) => {
    const list = r.searchResults.results.map((s, j) => `    ${j + 1}. ${s.title || "No title"} (${s.domain}) — ${s.url}`).join("\n");
    return `${i + 1}. Query: “${r.question}”\nAI Overview: ${r.searchResults.ai_overview}\nSources:\n${list}`;
  })
  .join("\n\n")}

**Write-phase instruction:**  
${
  mustStayInBody
    ? `🔒 You still need roughly ${remainingChars.toLocaleString()} more characters \
before concluding.\n**Do NOT start the “Conclusion” or “Bibliography” sections in this response.**`
    : `✅ The draft is long enough to conclude. You may now write the \
“Conclusion” followed immediately by the “Bibliography”.`
}

**Length guideline for *this* response:**  
Aim for ≈${Math.min(remainingChars || 1500).toLocaleString()} characters.

**Remember:** If you cannot finish, end with **${continuationMarker}T**. THIS IS VERY IMPORTANT
`.trim();

  return { systemPrompt, userPrompt };
};

const FINAL_REPORT_PROMPT_OLD = ({
  topic,
  latestResearchPlan,
  sources,
  queries,
  latestReasoning,
  maxOutputTokens,
  continuationMarker,
  targetOutputTokens,
  currentReport = "",
  currentOutputLength = 0,
}: {
  topic: string;
  latestResearchPlan: string;
  sources: WebSearchResult[];
  queries: string[];
  latestReasoning: string;
  maxOutputTokens: number;
  continuationMarker: string;
  targetOutputTokens: number;
  currentReport?: string;
  currentOutputLength?: number;
}) => {
  const systemPrompt = `You are a world-class research analyst and writer. Your task is to produce a single, cohesive deep research article based on multiple research findings related to a main research topic.

1. Introduce the topic—outlining scope, importance, and objectives.  
2. Synthesize intermediate analyses into a structured narrative.  
3. Identify and group key themes and patterns across sources.  
4. Highlight novel insights not explicitly stated in any single source.  
5. Note contradictions or conflicts, resolving them or framing open debates.  
6. Pinpoint remaining gaps and recommend avenues for further inquiry.  
7. Conclude with a concise summary of findings and implications.  
8. Cite every factual claim or statistic with in-text references (e.g. “[1](https://source.com)”) and append a numbered bibliography.  

**Continuation rule:**  
If you cannot complete the report in this response, **you must** append exactly:  
${continuationMarker}

**Draft continuity:**  
If there is an existing draft, continue seamlessly—preserve its content and structure, and build upon it rather than restarting.  
`;

  const userPrompt = `Main Research Topic:
${topic}

Existing Draft (≈${currentOutputLength} characters):
${currentReport}

Latest Research Plan:
${latestResearchPlan}

Latest Reasoning:
${latestReasoning}

Sub-Queries:
${queries.map((q) => `- ${q}`).join("\n")}

Search Results Overview:
${sources
  .map((r, i) => {
    const overview = r.searchResults.ai_overview;
    const list = r.searchResults.results.map((s, j) => `    ${j + 1}. ${s.title || "No title"} (${s.domain}) — ${s.url}`).join("\n");
    return `${i + 1}. Query: "${r.question}"  
AI Overview: ${overview}  
Sources:
${list}`;
  })
  .join("\n\n")}

**Requirements for this response:**
- **Length:** Produce at least **${targetOutputTokens * 5}** characters total (including existing draft), 
but do not exceed **${maxOutputTokens * 5}** characters in this call.
- **Structure:** Follow the outline defined by the system prompt.
- **Continuation:** If you cannot finish, append **${continuationMarker}** at the end.

Continue writing the report now:
`;

  return { systemPrompt, userPrompt };
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
  evaluation: EVALUATION_PROMPT,
  finalReport: FINAL_REPORT_PROMPT,
  research: RESEARCH_PROMPT_TEMPLATE,
  reasoningSearchResults: REASONING_SEARCH_RESULTS_PROMPT,
  decisionMaking: DECISION_MAKING_PROMPT,
};
