import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configuration
const ARRAY_SIZES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];
const SAMPLES_PER_SIZE = 10;
const MIN_VALUE = 1;
const MAX_VALUE = 10_000;

// Generate random array of integers
function generateRandomArray(size: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < size; i++) {
    arr.push(Math.floor(Math.random() * (MAX_VALUE - MIN_VALUE + 1)) + MIN_VALUE);
  }
  return arr;
}

// Check if two arrays are exactly equal
function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Ask LLM to sort the array
async function askLLMToSort(numbers: number[]): Promise<{
  result: number[] | null;
  tokensUsed: number;
  latencyMs: number;
  error?: string;
}> {
  const prompt = `Sort the following array of integers in ascending order.

IMPORTANT: Return ONLY the sorted array as a JSON array of numbers. No explanation, no markdown, just the JSON array.

Array to sort:
${JSON.stringify(numbers)}`;

  const startTime = performance.now();

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });

    const endTime = performance.now();
    const latencyMs = Math.round(endTime - startTime);
    const tokensUsed = response.usage?.total_tokens || 0;

    const content = response.choices[0]?.message?.content || "";

    try {
      // Clean up response (remove markdown if present)
      let jsonStr = content.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      }

      const result = JSON.parse(jsonStr) as number[];
      return { result, tokensUsed, latencyMs };
    } catch (parseError) {
      return {
        result: null,
        tokensUsed,
        latencyMs,
        error: `Parse error`,
      };
    }
  } catch (apiError: any) {
    const endTime = performance.now();
    return {
      result: null,
      tokensUsed: 0,
      latencyMs: Math.round(endTime - startTime),
      error: apiError.message,
    };
  }
}

// Run a single test - returns true if exact match, false otherwise
async function runSingleTest(size: number): Promise<{
  passed: boolean;
  tokensUsed: number;
  latencyMs: number;
}> {
  const numbers = generateRandomArray(size);
  const expectedSorted = [...numbers].sort((a, b) => a - b);

  const result = await askLLMToSort(numbers);

  if (result.error || !result.result) {
    return {
      passed: false,
      tokensUsed: result.tokensUsed,
      latencyMs: result.latencyMs,
    };
  }

  const passed = arraysEqual(expectedSorted, result.result);

  return {
    passed,
    tokensUsed: result.tokensUsed,
    latencyMs: result.latencyMs,
  };
}

// Main function
async function main() {
  console.log("🔢 LLM Sorting Test (GPT-5.1)");
  console.log("═".repeat(60));
  console.log(`\nConfiguration:`);
  console.log(`  - Random integers: ${MIN_VALUE.toLocaleString()} - ${MAX_VALUE.toLocaleString()}`);
  console.log(`  - Array sizes: ${ARRAY_SIZES.join(", ")}`);
  console.log(`  - Samples per size: ${SAMPLES_PER_SIZE}`);
  console.log(`\nScoring: Exact match = ✅, Any error = ❌\n`);

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Error: OPENAI_API_KEY environment variable not set");
    console.log("\nRun with: OPENAI_API_KEY=sk-... bun scripts/llm-sort.ts");
    process.exit(1);
  }

  // Results storage
  const results: Map<number, { passRate: number; samples: boolean[]; avgLatency: number }> = new Map();

  // Run tests for each size
  for (const size of ARRAY_SIZES) {
    process.stdout.write(`Testing size ${size.toString().padStart(3)}... `);
    
    const samples: boolean[] = [];
    let totalLatency = 0;

    for (let sample = 0; sample < SAMPLES_PER_SIZE; sample++) {
      const result = await runSingleTest(size);
      samples.push(result.passed);
      totalLatency += result.latencyMs;
      process.stdout.write(result.passed ? "✅" : "❌");
    }

    const passRate = Math.round((samples.filter(s => s).length / SAMPLES_PER_SIZE) * 100);
    const avgLatency = Math.round(totalLatency / SAMPLES_PER_SIZE);
    
    console.log(` ${passRate}%`);
    results.set(size, { passRate, samples, avgLatency });
  }

  // Summary table
  console.log("\n" + "═".repeat(60));
  console.log("📋 SUMMARY");
  console.log("═".repeat(60));
  console.log("");

  console.log("| Size | Pass Rate | Avg Latency | Samples            |");
  console.log("|------|-----------|-------------|---------------------|");

  for (const size of ARRAY_SIZES) {
    const data = results.get(size)!;
    const sizeStr = size.toString().padStart(4);
    const passRateStr = `${data.passRate}%`.padStart(9);
    const latencyStr = `${data.avgLatency}ms`.padStart(11);
    const samplesStr = data.samples.map(s => s ? "✅" : "❌").join("");
    
    console.log(`| ${sizeStr} | ${passRateStr} | ${latencyStr} | ${samplesStr} |`);
  }

  // Find the cliff
  let cliffSize = ARRAY_SIZES[ARRAY_SIZES.length - 1];
  for (const size of ARRAY_SIZES) {
    const data = results.get(size)!;
    if (data.passRate < 100) {
      cliffSize = size;
      break;
    }
  }

  console.log("");
  console.log("═".repeat(60));
  console.log(`💡 The "cliff" appears around size ${cliffSize}`);
  console.log("   LLMs struggle with exact sorting as array size increases.");
  console.log("═".repeat(60));
}

main().catch(console.error);
