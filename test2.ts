import { DeepResearch } from "./src/index";
import "dotenv/config";
(async () => {
  const deepResearch = new DeepResearch({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPINFRA_API_KEY: process.env.DEEPINFRA_API_KEY,
    JIGSAW_API_KEY: process.env.JIGSAW_API_KEY,
    logging: {
      enabled: true,
    },
  });

  const result = await deepResearch.generate(
    `Write a complete, original, long-form blog post for Strata Trading about: "Point of Control POC Value Area trading volume profile".\n' +
    '\n' +
    'Requirements:\n' +
    '- Audience: active futures/stock/FX traders.\n' +
    '- Company: Strata Trading (StrataLevels, StrataLevelsPro). Link naturally to /products.html and /docs.html.\n' +
    '- Emphasize: multi-timeframe S/R with strength scoring, Prior Day OHLC, Pre/Overnight, IB, POC/VA; explain how these help trade context and decision-making.\n' +
    '- SEO: clear H2 section headings, scannable structure, concise, authoritative tone.\n' +
    '- Include YAML front-matter (title, description, date YYYY-MM-DD, slug, tags).\n' +
    '- Body: H1, intro (2–3 paragraphs), 5–6 H2 sections with actionable guidance, conclusion.\n' +
    '- References section with numbered links for any external claims.\n' +
    '- Compliance: add one-line footer "Strata Trading provides software tools for analysis. Not financial advice."\n`
  );
  console.log(result);
})();
