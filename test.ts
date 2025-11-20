import { createDeepResearch } from "./src";
import dotenv from "dotenv";

dotenv.config();

const deepResearch = createDeepResearch({
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  JIGSAW_API_KEY: process.env.JIGSAW_API_KEY,
  logging: {
    enabled: true,
  },
});

(async () => {
  const research = await deepResearch.generate("What is the capital of France?");

  console.log(research);
})();
