import bodyParser from "body-parser";
import express from "express";
import "dotenv/config";
import { createDeepResearch } from "./index";
import { logger } from "./utils/logger";

logger.setEnabled(false);
// Research result interface
interface ResearchResult {
  status: string;
  data: {
    text: string;
    metadata: {
      prompt: string;
      iterationCount: number;
      completionStatus: boolean;
      reasoning: string;
      researchPlan: string;
      queries: string[];
      sources: any[]; // Using any for sources as the exact type depends on your implementation
    };
  };
}

// Session interface
interface ResearchSession {
  deepResearch: any; // Type could be more specific based on your DeepResearch implementation
  status: "initialized" | "running" | "completed" | "failed";
  result?: ResearchResult["data"]; // Store just the data part
  error?: string;
}

// Initialize Express app
const app = express();
app.use(bodyParser.json());

// For storing active research instances
const activeResearch = new Map<string, ResearchSession>();

// Routes
// 1. Start a new research session
app.post("/api/research", async (req, res) => {
  console.log("POST /api/research - Request received:", {
    configProvided: !!req.body.config,
  });
  try {
    const { config = {} } = req.body;

    // Create a unique ID for this research session
    const sessionId = Date.now().toString();

    // Initialize DeepResearch
    const deepResearch = createDeepResearch(config);

    // Store the instance
    activeResearch.set(sessionId, { deepResearch, status: "initialized" });

    return res.json({
      status: "success",
      message: "Research session initialized",
      sessionId,
    });
  } catch (error: any) {
    console.error("Failed to initialize research:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to initialize research",
    });
  }
});

// 2. Run the research for a given session
app.post("/api/research/run", async (req, res) => {
  console.log("POST /api/research/run - Request received:", {
    prompt: req.body.prompt,
    sessionId: req.body.sessionId,
  });

  try {
    const { prompt, sessionId } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const session = activeResearch.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Update status
    session.status = "running";

    // Run the research asynchronously
    const runPromise = session.deepResearch
      .generate(prompt)
      .then((result: ResearchResult) => {
        session.result = result.data;
        session.status = "completed";
        return result;
      })
      .catch((error) => {
        session.error = error.message || "Research failed";
        session.status = "failed";
        console.error("Research failed:", error);
      });

    // Immediately return a response indicating the research is running
    return res.json({
      status: "success",
      message: "Research started",
      sessionId,
      prompt,
    });
  } catch (error: any) {
    console.error("Failed to run research:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to run research",
    });
  }
});

// 3. Get the status or result of a research session
app.get("/api/research/run/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = activeResearch.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Return the appropriate response based on session status
  if (session.status === "completed") {
    return res.json({
      status: "success",
      sessionStatus: session.status,
      result: session.result,
    });
  } else if (session.status === "failed") {
    return res.json({
      status: "error",
      sessionStatus: session.status,
      error: session.error,
    });
  } else {
    return res.json({
      status: "success",
      sessionStatus: session.status,
    });
  }
});

// Define port
const PORT = process.env.PORT || 3000;

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
