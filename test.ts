import { createDeepResearch } from "./src/index";
import "dotenv/config";

const deepResearch = createDeepResearch({
  OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  DEEPINFRA_API_KEY: process.env.DEEPINFRA_API_KEY!,
  JIGSAW_API_KEY: process.env.JIGSAW_API_KEY!,
  logging: {
    enabled: false,
  },
});

function formatTime(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;

  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatMs(ms: number) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// 5 different types of queries to profile
const queries = [
  {
    name: "Technology - Recent Developments",
    prompt: "What are the recent developments in quantum computing?",
  },
  {
    name: "Science - Research Question",
    prompt: "What are the latest findings on CRISPR gene editing applications in medicine?",
  },
  {
    name: "Current Events",
    prompt: "What are the major economic trends in 2024?",
  },
  {
    name: "Comparative Analysis",
    prompt: "Compare the environmental impact of electric vehicles versus hydrogen fuel cell vehicles",
  },
];

interface ProfileResult {
  queryName: string;
  prompt: string;
  totalTime: number;
  durations: {
    researchPlan: number;
    searchResults: number;
    reasoning: number;
    decision: number;
    generateReport: number;
  };
  iterationTimings: Array<{
    iteration: number;
    researchPlan: number;
    searchResults: number;
    reasoning: number;
    decision: number;
    total: number;
  }>;
  tokenUsage: {
    research_tokens: number;
    reasoning_tokens: number;
    report_tokens: number;
    decision_tokens: number;
    total_tokens: number;
  };
  metadata: {
    numQueries: number;
    numSources: number;
    numIterations: number;
  };
  success: boolean;
  data?: any;
  _usage?: any;
}

(async () => {
  console.log("╔════════════════════════════════════════════════════════════════════╗");
  console.log("║       DEEP RESEARCH PROFILING - 5 QUERIES (PARALLEL)              ║");
  console.log("╚════════════════════════════════════════════════════════════════════╝\n");

  console.log("🚀 Starting all 5 queries in parallel...\n");

  const completedQueries = new Set<string>();
  let elapsed = 0;

  // Global timer showing overall progress
  const globalTimer = setInterval(() => {
    elapsed++;
    process.stdout.write(`\r⏱️  Overall time elapsed: ${formatTime(elapsed * 1000)} | Completed: ${completedQueries.size}/${queries.length} `);
  }, 1000);

  const overallStartTime = performance.now();

  // Run all queries in parallel
  const results = await Promise.all(
    queries.map(async (query, index) => {
      const startTime = performance.now();

      try {
        const result = await deepResearch.generate(query.prompt);
        const endTime = performance.now();
        const totalTime = endTime - startTime;

        completedQueries.add(query.name);

        return {
          queryName: query.name,
          prompt: query.prompt,
          totalTime,
          durations: result.duration,
          iterationTimings: result.iterationTimings,
          tokenUsage: result._usage,
          metadata: {
            numQueries: result.data.metadata.queries.length,
            numSources: result.data.metadata.sources.length,
            numIterations: result.iterationTimings.length,
          },
          success: true,
          data: result.data,
          _usage: result._usage,
        };
      } catch (error) {
        completedQueries.add(query.name);
        console.error(`\n❌ Error in "${query.name}": ${error}`);

        return {
          queryName: query.name,
          prompt: query.prompt,
          totalTime: 0,
          durations: {
            researchPlan: 0,
            searchResults: 0,
            reasoning: 0,
            decision: 0,
            generateReport: 0,
          },
          iterationTimings: [],
          tokenUsage: {
            research_tokens: 0,
            reasoning_tokens: 0,
            report_tokens: 0,
            decision_tokens: 0,
            total_tokens: 0,
          },
          metadata: {
            numQueries: 0,
            numSources: 0,
            numIterations: 0,
          },
          success: false,
        };
      }
    })
  );

  clearInterval(globalTimer);
  const overallEndTime = performance.now();
  const overallTime = overallEndTime - overallStartTime;

  process.stdout.write("\r" + " ".repeat(80) + "\r"); // Clear the timer line
  console.log(`✅ All queries completed in ${formatTime(overallTime)} (parallel execution)\n`);

  // Display individual results
  for (let i = 0; i < results.length; i++) {
    const result = results[i];

    console.log(`\n${"=".repeat(70)}`);
    console.log(`Query ${i + 1}/${queries.length}: ${result.queryName}`);
    console.log(`${"=".repeat(70)}`);
    console.log(`Prompt: "${result.prompt}"\n`);

    if (!result.success) {
      console.log("❌ Query failed\n");
      continue;
    }

    console.log(`✅ Completed in ${formatTime(result.totalTime)}`);
    console.log("\n📊 Performance Breakdown (Total):");
    console.log(`  Research Planning:  ${formatMs(result.durations.researchPlan)}`);
    console.log(`  Web Search:         ${formatMs(result.durations.searchResults)}`);
    console.log(`  Reasoning:          ${formatMs(result.durations.reasoning)}`);
    console.log(`  Decision Making:    ${formatMs(result.durations.decision)}`);
    console.log(`  Report Generation:  ${formatMs(result.durations.generateReport)}`);

    // Show detailed iteration timings if multiple iterations occurred
    if (result.iterationTimings && result.iterationTimings.length > 0) {
      console.log(`\n🔄 Detailed Iteration Timings (${result.iterationTimings.length} iteration${result.iterationTimings.length > 1 ? "s" : ""}):`);

      for (const iterTiming of result.iterationTimings) {
        console.log(`\n  ┌─ Iteration ${iterTiming.iteration} (Total: ${formatMs(iterTiming.total)})`);
        console.log(
          `  ├─ Research Planning:  ${formatMs(iterTiming.researchPlan).padStart(10)} (${((iterTiming.researchPlan / iterTiming.total) * 100).toFixed(1)}%)`
        );
        console.log(
          `  ├─ Web Search:         ${formatMs(iterTiming.searchResults).padStart(10)} (${((iterTiming.searchResults / iterTiming.total) * 100).toFixed(1)}%)`
        );
        console.log(
          `  ├─ Reasoning:          ${formatMs(iterTiming.reasoning).padStart(10)} (${((iterTiming.reasoning / iterTiming.total) * 100).toFixed(1)}%)`
        );
        console.log(
          `  └─ Decision Making:    ${formatMs(iterTiming.decision).padStart(10)} (${((iterTiming.decision / iterTiming.total) * 100).toFixed(1)}%)`
        );
      }
    }

    console.log("\n🪙 Token Usage:");
    console.log(`  Research:   ${result.tokenUsage.research_tokens.toLocaleString()}`);
    console.log(`  Reasoning:  ${result.tokenUsage.reasoning_tokens.toLocaleString()}`);
    console.log(`  Decision:   ${result.tokenUsage.decision_tokens.toLocaleString()}`);
    console.log(`  Report:     ${result.tokenUsage.report_tokens.toLocaleString()}`);
    console.log(`  Total:      ${result.tokenUsage.total_tokens.toLocaleString()}`);

    console.log("\n📚 Research Metadata:");
    console.log(`  Iterations:        ${result.iterationTimings.length}`);
    console.log(`  Queries Generated: ${result.metadata.numQueries}`);
    console.log(`  Sources Found:     ${result.metadata.numSources}`);
    if (result.data) {
      console.log(`  Report Length:     ${result.data.text.length.toLocaleString()} chars`);
    }
  }

  // Print summary
  console.log(`\n\n${"=".repeat(70)}`);
  console.log("📈 PROFILING SUMMARY");
  console.log(`${"=".repeat(70)}\n`);

  // Filter successful results for statistics
  const successfulResults = results.filter((r) => r.success);

  console.log("┌─────────────────────────────────────────┬──────────┬────────────┐");
  console.log("│ Query Type                              │ Time     │ Tokens     │");
  console.log("├─────────────────────────────────────────┼──────────┼────────────┤");

  for (const result of results) {
    const name = result.queryName.padEnd(39);
    const time = result.success ? formatTime(result.totalTime).padEnd(8) : "FAILED  ";
    const tokens = result.success ? result.tokenUsage.total_tokens.toLocaleString().padStart(10) : "N/A".padStart(10);
    console.log(`│ ${name} │ ${time} │ ${tokens} │`);
  }

  console.log("└─────────────────────────────────────────┴──────────┴────────────┘\n");

  // Calculate averages from successful results only
  const avgTime = successfulResults.reduce((sum, r) => sum + r.totalTime, 0) / successfulResults.length;
  const avgTokens = successfulResults.reduce((sum, r) => sum + r.tokenUsage.total_tokens, 0) / successfulResults.length;
  const totalTokens = successfulResults.reduce((sum, r) => sum + r.tokenUsage.total_tokens, 0);
  const longestQueryTime = Math.max(...successfulResults.map((r) => r.totalTime));
  const speedupFactor = (longestQueryTime * results.length) / overallTime;

  console.log("📊 Averages (per query):");
  console.log(`  Average Time:       ${formatTime(avgTime)}`);
  console.log(`  Average Tokens:     ${Math.round(avgTokens).toLocaleString()}`);
  console.log(`  Total Tokens:       ${totalTokens.toLocaleString()}`);
  console.log(
    `  Average Iterations: ${(successfulResults.reduce((sum, r) => sum + r.metadata.numIterations, 0) / successfulResults.length).toFixed(1)}`
  );

  console.log("\n⚡ Parallel Execution Benefits:");
  console.log(`  Sequential Time (estimated): ${formatTime(successfulResults.reduce((sum, r) => sum + r.totalTime, 0))}`);
  console.log(`  Parallel Time (actual):      ${formatTime(overallTime)}`);
  console.log(`  Time Saved:                  ${formatTime(successfulResults.reduce((sum, r) => sum + r.totalTime, 0) - overallTime)}`);
  console.log(`  Speedup Factor:              ${speedupFactor.toFixed(2)}x`);
  console.log(`  Efficiency:                  ${((speedupFactor / results.length) * 100).toFixed(1)}%`);

  // Breakdown by phase (averages)
  const avgDurations = {
    researchPlan: successfulResults.reduce((sum, r) => sum + r.durations.researchPlan, 0) / successfulResults.length,
    searchResults: successfulResults.reduce((sum, r) => sum + r.durations.searchResults, 0) / successfulResults.length,
    reasoning: successfulResults.reduce((sum, r) => sum + r.durations.reasoning, 0) / successfulResults.length,
    decision: successfulResults.reduce((sum, r) => sum + r.durations.decision, 0) / successfulResults.length,
    generateReport: successfulResults.reduce((sum, r) => sum + r.durations.generateReport, 0) / successfulResults.length,
  };

  console.log("\n⏱️  Average Time by Phase:");
  console.log(`  Research Planning:  ${formatMs(avgDurations.researchPlan)} (${((avgDurations.researchPlan / avgTime) * 100).toFixed(1)}%)`);
  console.log(`  Web Search:         ${formatMs(avgDurations.searchResults)} (${((avgDurations.searchResults / avgTime) * 100).toFixed(1)}%)`);
  console.log(`  Reasoning:          ${formatMs(avgDurations.reasoning)} (${((avgDurations.reasoning / avgTime) * 100).toFixed(1)}%)`);
  console.log(`  Decision Making:    ${formatMs(avgDurations.decision)} (${((avgDurations.decision / avgTime) * 100).toFixed(1)}%)`);
  console.log(`  Report Generation:  ${formatMs(avgDurations.generateReport)} (${((avgDurations.generateReport / avgTime) * 100).toFixed(1)}%)`);

  // Show detailed iteration comparison across all queries
  console.log("\n🔬 Iteration-by-Iteration Analysis:");

  // Find max iterations across all successful queries
  const maxIterations = Math.max(...successfulResults.map((r) => r.metadata.numIterations));

  if (maxIterations > 0) {
    for (let iterNum = 1; iterNum <= maxIterations; iterNum++) {
      console.log(`\n  Iteration ${iterNum}:`);

      for (const result of successfulResults) {
        const iterTiming = result.iterationTimings.find((it) => it.iteration === iterNum);

        if (iterTiming) {
          const name = result.queryName.padEnd(35);
          console.log(
            `    ${name} | Total: ${formatMs(iterTiming.total).padStart(8)} | Search: ${formatMs(iterTiming.searchResults).padStart(8)} | Reasoning: ${formatMs(iterTiming.reasoning).padStart(8)}`
          );
        } else {
          const name = result.queryName.padEnd(35);
          console.log(`    ${name} | (not run)`);
        }
      }
    }

    // Show how time changes across iterations (for queries with multiple iterations)
    const multiIterResults = successfulResults.filter((r) => r.metadata.numIterations > 1);
    if (multiIterResults.length > 0) {
      console.log("\n  ⚠️  Performance Trend (queries with multiple iterations):");
      for (const result of multiIterResults) {
        if (result.iterationTimings.length > 1) {
          const firstIter = result.iterationTimings[0];
          const lastIter = result.iterationTimings[result.iterationTimings.length - 1];
          const percentChange = ((lastIter.total - firstIter.total) / firstIter.total) * 100;
          const trend = percentChange > 0 ? "⬆️ slower" : "⬇️ faster";

          console.log(
            `    ${result.queryName.padEnd(35)} | Iter 1: ${formatMs(firstIter.total).padStart(8)} → Iter ${lastIter.iteration}: ${formatMs(lastIter.total).padStart(8)} (${percentChange > 0 ? "+" : ""}${percentChange.toFixed(1)}% ${trend})`
          );
        }
      }
    }
  }

  console.log("\n✨ Profiling complete!\n");
})();
