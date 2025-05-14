# Deep Research Test Script

This script helps verify that the `generateTestFile` method in the DeepResearch class is working correctly by creating test files with mock data.

## Setup

1. Make sure you have all required environment variables in your `.env` file:

   ```
   JIGSAW_API_KEY=your_jigsaw_api_key
   OPENAI_API_KEY=your_openai_api_key
   GEMINI_API_KEY=your_gemini_api_key
   DEEPINFRA_API_KEY=your_deepinfra_api_key
   ```

2. Ensure you have built the project:
   ```
   npm run build
   ```

## Running the Test

Execute the test script:

```
node test-script.js
```

## Expected Output

The script will:

1. Create a DeepResearch instance with mock data
2. Call the `generateTestFile` method
3. Log success or error messages

## Generated Files

After running the test, check the `logs` directory for the following files:

- `config.json`: Configuration used for the research
- `prompts.md`: Research prompts
- `synthesis_by_depth.json`: Synthesis results organized by depth
- `all_syntheses.json`: All syntheses in a single array
- `final_report.json`: Final research report in JSON format
- `final_report.md`: Final research report in Markdown format
- `research_summary.json`: Summary of all research findings
- `research_log.md`: Detailed markdown log of the research process

## Troubleshooting

If you encounter errors:

1. Ensure your API keys are correct in `.env`
2. Make sure you've built the project with `npm run build`
3. Check console output for specific error messages
