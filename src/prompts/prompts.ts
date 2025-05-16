/**
 * System and user prompts for the deep research pipeline
 */

import { WebSearchResult } from "../types";

// Synthesize information from search results
const SYNTHESIS_PROMPT_TEMPLATE = `You are an expert research synthesizer. Your task is to analyze and synthesize information from multiple search results related to a main research topic.

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

const RESEARCH_PROMPT_TEMPLATE = "";

// Generate follow-up questions based on search results
const FOLLOWUP_QUESTION_PROMPT_TEMPLATE = `You are an expert research planner. Your task is to analyze search results for a question and generate targeted follow-up questions to explore knowledge gaps or go deeper into interesting aspects.

Based on the search results provided, generate 2-3 follow-up questions that:
1. Address knowledge gaps identified in the current results
2. Explore interesting aspects that weren't fully covered
3. Dig deeper into promising areas mentioned briefly
4. Are specific and focused enough to yield useful additional information
5. Do not repeat information that's already well-covered
6. Are phrased as clear, direct questions (not statements)

Format each question as a single string.`;

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

    PROCESS:
    1. Identify ALL information explicitly requested in the original research goal
    2. Analyze what specific information has been successfully retrieved in the search results
    3. Identify ALL information gaps between what was requested and what was found
    4. For entity-specific gaps: Create targeted queries for each missing attribute of identified entities
    5. For general knowledge gaps: Create focused queries to find the missing conceptual information

    QUERY GENERATION RULES:
    - IF specific entities were identified AND specific attributes are missing:
    * Create direct queries for each entity-attribute pair (e.g., "LeBron James height")
    - IF general knowledge gaps exist:
    * Create focused queries to address each conceptual gap (e.g., "criteria for ranking basketball players")
    - Queries must be constructed to directly retrieve EXACTLY the missing information
    - Avoid tangential or merely interesting information not required by the original goal
    - Prioritize queries that will yield the most critical missing information first

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

// Evaluation Parsing: Extracts structured data from evaluation output
const EVALUATION_PARSE_PROMPT_TEMPLATE = `
        You are a research assistant, you will be provided with a some reasoning and a list of queries, and you will need to parse the list into a list of queries.`;

const FINAL_REPORT_PROMPT = ({
  mainPrompt,
  synthesis,
  searchResults,
  maxOutputTokens,
  targetOutputLength,
}: {
  mainPrompt: string[];
  synthesis: string;
  searchResults: WebSearchResult[];
  maxOutputTokens?: number;
  targetOutputLength?: "concise" | "standard" | "detailed" | number;
}) => {
  // Convert targetLength to specific instructions
  let lengthGuidance = "";
  if (targetOutputLength) {
    if (typeof targetOutputLength === "number") {
      lengthGuidance = `CRITICAL REQUIREMENT: Your response MUST be at least ${targetOutputLength} tokens long. This is not a suggestion but a strict requirement. Please provide extensive detail, examples, analysis, and elaboration on all aspects of the topic to reach this minimum length. Do not summarize or be concise.`;
    } else {
      switch (targetOutputLength) {
        case "concise":
          lengthGuidance = "Please be very concise, focusing only on the most essential information.";
          break;
        case "standard":
          lengthGuidance = "Please provide a balanced synthesis with moderate detail.";
          break;
        case "detailed":
          lengthGuidance = "Please provide a comprehensive analysis with substantial detail.";
          break;
      }
    }
  }

  const systemPrompt = `You are a world-class research analyst and writer. Your task is to produce a single, cohesive deep research article based on multiple research findings related to a main research topic.
        
        You will:
        1. Introduce the topic—outlining scope, importance, and objectives.
        2. Synthesize all intermediate analyses, weaving them into a structured narrative.
        3. Identify and group the key themes and patterns that emerge across sources.
        4. Highlight novel insights your analysis uncovers—points not explicitly stated in any one source.
        5. Note contradictions or conflicts in the literature, resolving them or clearly framing open debates.
        6. Pinpoint remaining knowledge gaps and recommend avenues for further inquiry.
        7. Conclude with a concise summary of findings and practical or theoretical implications.
        8. Cite every factual claim or statistic with in-text references (e.g. "[1]", "[2]") and append a numbered bibliography.
        
        Structure your output exactly like this:
        – Title: A descriptive, engaging headline  
        – Abstract: 3–5 sentences summary  
        – Table of Contents (with section headings)  
        – 1. Introduction  
        – 2. Background & Literature Review  
        – 3. Thematic Synthesis  
         3.1 Theme A  
         3.2 Theme B  
        – 4. Novel Insights  
        – 5. Conflicting Evidence & Resolutions  
        – 6. Knowledge Gaps & Future Directions  
        – 7. Conclusion  
        – References
        `;

  const userPrompt = `Main Research Topic(s):
        ${mainPrompt.join("\n")}
        
        ${lengthGuidance}
        
        ${maxOutputTokens ? `Your response must not exceed ${maxOutputTokens} tokens.` : ""}
        
        Intermediate Research Syntheses:
        ${synthesis}

        Search Results:
        ${searchResults.map((result) => result.searchResults).join("\n")}
        
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
  synthesis: `${getCurrentDateContext()}\n${SYNTHESIS_PROMPT_TEMPLATE}`,
  followupQuestion: `${getCurrentDateContext()}\n${FOLLOWUP_QUESTION_PROMPT_TEMPLATE}`,
  evaluation: EVALUATION_PROMPT,
  evaluationParse: `${EVALUATION_PARSE_PROMPT_TEMPLATE}`,
  finalReport: FINAL_REPORT_PROMPT,
};
