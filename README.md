# Deep Research

Deep Research is an open source library for conducting deep, multi-hop research with reasoning capabilities. It performs focused web searches with recursive exploration to provide comprehensive, evidence-backed answers to complex questions.

![Deep Research Architecture](/public/open_deep_research_diagram.png)

## ✨ Key Features

Deep Research is designed to be your comprehensive solution for AI-powered research:

- 🧠 Advanced multi-hop reasoning for complex questions
- 🌐 Real-time web search with recursive exploration
- 🔍 Automatic subquery generation for comprehensive coverage
- 📊 Intelligent depth and breadth control for research thoroughness
- 📝 Evidence-based report generation with proper citations
- 📚 Automatic bibliography generation with source tracking
- 🔄 Iterative research cycles for deeper understanding
- 🤖 Multi-model support with specialized reasoning capabilities
- ⚡ Flexible configuration for customizing research parameters
- 📈 Scalable from simple inquiries to complex research problems


## 🧱 Core Concepts

| Concept           | Description                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Deep Thinking** | The system breaks down a question into logical parts, reasons through them independently, and synthesizes an answer. |
| **Deep Research** | The system performs multi-hop, focused web searches, compares the findings, and composes an evidence-backed answer.  |

## 🚀 Installation

```bash
npm i deep-research
# or
yarn add deep-research
# or
bun i deep-research
```

## 🚀 Quick Start

### Basic Usage

```typescript
import { createDeepResearch } from "deep-research";

// Create instance using the factory function with default settings
const deepResearch = createDeepResearch({
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  DEEPINFRA_API_KEY: process.env.DEEPINFRA_API_KEY,
  JIGSAW_API_KEY: process.env.JIGSAW_API_KEY,
});

// Research prompt
const prompt = "What are the recent developments in quantum computing?";

// Generate research report
const result = await deepResearch.generate(prompt);

console.log(result.data.text);
console.log(result.data.bibliography);
```

### Advanced Usage

```typescript
import { createDeepResearch } from "open-deep-research";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createOpenAI } from "@ai-sdk/openai";

// Initialize AI providers
const gemini = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const deepinfra = createDeepInfra({
  apiKey: process.env.DEEPINFRA_API_KEY,
});

const openaiProvider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Get model instances
const geminiModel = gemini("gemini-2.0-flash");
const deepseekModel = deepinfra("deepseek-ai/DeepSeek-R1");
const openaiModel = openaiProvider("gpt-4o");

// Create instance with custom configuration
const deepResearch = createDeepResearch({
  report: {
    maxOutputTokens: 30000, // Hard limit on report length
    targetOutputTokens: 10000, // Target report length
  },
  depth: {
    maxDepth: 4, // How many iterations of research to perform
  },
  breadth: {
    maxBreadth: 3, // How many subqueries to generate
  },
  models: {
    default: openaiModel, // Custom models from AI SDK
    reasoning: deepseekModel,
    output: geminiModel,
  },
  logging: {
    enabled: true, // Enable console logging
  },
});

// Research prompt
const prompt = "What are the recent developments in quantum computing?";

// Generate research report
const result = await deepResearch.generate(prompt);

console.log(result.data.text);
console.log(result.data.bibliography);
```

## Configuration Options for Deep Research

| Category | Option | Type | Default | Description |
|----------|--------|------|---------|-------------|
| **depth** | maxDepth | Number | 3 | Controls how many iterations of research the system will perform. Higher values allow for more thorough, multi-hop research. The system will continue researching until it has a complete answer or reaches this limit. |
| **breadth** | maxBreadth | Number | 3 | Controls how many subqueries are generated for each research iteration. Higher values enable wider exploration of the topic. Determines how many parallel search paths are pursued. |
| **report** | maxOutputTokens | Number | 32000 | Hard upper limit on the length of the final report. Must be greater than targetOutputTokens. |
| | targetOutputTokens | Number | optional | The ideal length for the generated report. The system will try to produce a report of approximately this length. |
| **models** | default | LanguageModelV1 | GPT-4.1 | The primary model used for most operations. |
| | reasoning | LanguageModelV1 | DeepSeek-R1 | Model used for reasoning about search results. |
| | output | LanguageModelV1 | GPT-4.1 | Model used for generating the final report. |
| **logging** | enabled | Boolean | false | When set to true, enables detailed console logging. Helpful for debugging and understanding the research process. |
| **API Keys** | JIGSAW_API_KEY | String | required | For accessing the JigsawStack API for web searches. |
| | OPENAI_API_KEY | String | required | For OpenAI model access. |
| | GEMINI_API_KEY | String | required | For Google Gemini model access. |
| | DEEPINFRA_API_KEY | String | required | For DeepInfra model access. |

## 🧩 How It Works

1️⃣ **Research Planning & Analysis**

- Creates a DeepResearch instance with user-provided configuration
- Analyzes the input prompt to understand requirements
- Generates a comprehensive research plan
- Breaks down into focused sub-queries using LLMs

2️⃣ **Data Collection & Processing**

- Executes AI-powered web searches for each sub-query via JigsawStack API
- Gathers and validates relevant sources
- Generates context from search results
- Deduplicates URLs to ensure unique sources

3️⃣ **Analysis & Synthesis**

- Processes gathered information through reasoning models
- Analyzes and synthesizes the findings
- Evaluates information sufficiency
- Determines if additional research is needed
- Performs iterative research within configured depth limits if needed

4️⃣ **Report Generation & Citations**

- Creates comprehensive final report
- Iteratively generates content until complete
- Maps sources to reference numbers
- Generates bibliography with citations
- Formats output according to target length requirements

## 🛠️ Contributing

Contributions are welcome! Please feel free to submit a PR :)
