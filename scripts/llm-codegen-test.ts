import OpenAI from "openai";
import avro from "avsc";
import { spawn } from "child_process";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Define the Event type
interface Event {
  userId: string;
  duration: number;
}

// Result type
interface UserAverage {
  id: string;
  avg: number;
}

// Configuration
const NUM_USERS = 50;
const MIN_DURATION = 10;
const MAX_DURATION = 200;
const TEST_SIZES = [100, 1_000, 10_000, 100_000, 1_000_000];

// Generate random events (for computing correct answer)
function generateEvents(count: number): Event[] {
  // Use a seeded random for reproducibility
  const seed = 12345;
  let current = seed;
  const random = () => {
    current = (current * 1103515245 + 12345) & 0x7fffffff;
    return current / 0x7fffffff;
  };

  const events: Event[] = [];
  for (let i = 0; i < count; i++) {
    events.push({
      userId: `user${Math.floor(random() * NUM_USERS) + 1}`,
      duration: Math.floor(random() * (MAX_DURATION - MIN_DURATION + 1)) + MIN_DURATION,
    });
  }
  return events;
}

// Compute the correct answer locally
function computeCorrectAnswer(events: Event[]): UserAverage[] {
  const filtered = events.filter((e) => e.duration >= 50);
  const grouped = Object.groupBy(filtered, (e) => e.userId);
  const result = Object.entries(grouped).map(([id, group]) => ({
    id,
    avg: Math.round((group!.reduce((a, b) => a + b.duration, 0) / group!.length) * 100) / 100,
  }));
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

// Schema definition for the LLM
const SCHEMA_DESCRIPTION = `
Interface Event {
  userId: string;   // User identifier like "user1", "user2", etc.
  duration: number; // Duration in milliseconds (integer)
}
`;

const TASK_DESCRIPTION = `
Given an array of Event objects called "events", write TypeScript code that:
1. Filters out events where duration < 50
2. Groups the remaining events by userId
3. Calculates the average duration for each user
4. Returns the result as an array of objects with "id" (string) and "avg" (number rounded to 2 decimal places)
5. Sort the result by id

The code should be a single expression or statement that assigns to a variable called "result".
Do NOT include any imports, type definitions, or console.log statements.
Return ONLY the code, no markdown or explanation.
`;

// Ask LLM to generate code
async function generateCode(): Promise<{
  code: string;
  tokensUsed: number;
  latencyMs: number;
  error?: string;
}> {
  const prompt = `You are a TypeScript code generator. Given a schema and task, generate clean, working code.

SCHEMA:
${SCHEMA_DESCRIPTION}

TASK:
${TASK_DESCRIPTION}

Generate the TypeScript code:`;

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

    let code = response.choices[0]?.message?.content || "";
    
    // Clean up the code (remove markdown if present)
    code = code.trim();
    if (code.startsWith("```")) {
      code = code.replace(/```typescript?\n?/g, "").replace(/```/g, "").trim();
    }

    return { code, tokensUsed, latencyMs };
  } catch (apiError: any) {
    const endTime = performance.now();
    return {
      code: "",
      tokensUsed: 0,
      latencyMs: Math.round(endTime - startTime),
      error: apiError.message,
    };
  }
}

// Create the executor script that runs the generated code
function createExecutorScript(generatedCode: string): string {
  return `
import avro from "avsc";
import { join } from "path";

interface Event {
  userId: string;
  duration: number;
}

// Get the Avro file path from command line
const avroFile = process.argv[2];
if (!avroFile) {
  console.error("Usage: bun executor.ts <avro-file>");
  process.exit(1);
}

// Read events from Avro file
async function readAvroFile(filepath: string): Promise<Event[]> {
  return new Promise((resolve, reject) => {
    const events: Event[] = [];
    const decoder = avro.createFileDecoder(filepath);
    decoder.on("data", (record: Event) => events.push(record));
    decoder.on("end", () => resolve(events));
    decoder.on("error", reject);
  });
}

async function main() {
  const events = await readAvroFile(avroFile);
  
  // === LLM-GENERATED CODE START ===
  ${generatedCode}
  // === LLM-GENERATED CODE END ===
  
  // Output the result as JSON
  console.log(JSON.stringify(result));
}

main().catch(console.error);
`;
}

// Execute the generated code via subprocess
async function executeGeneratedCode(
  generatedCode: string,
  avroFilePath: string
): Promise<{
  result: UserAverage[] | null;
  latencyMs: number;
  error?: string;
}> {
  const tempDir = join(import.meta.dir, "..", ".temp");
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const executorPath = join(tempDir, "executor.ts");
  const executorScript = createExecutorScript(generatedCode);
  writeFileSync(executorPath, executorScript);

  const startTime = performance.now();

  return new Promise((resolve) => {
    const child = spawn("bun", [executorPath, avroFilePath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);

      if (code !== 0) {
        resolve({
          result: null,
          latencyMs,
          error: stderr || `Process exited with code ${code}`,
        });
        return;
      }

      try {
        const result = JSON.parse(stdout.trim()) as UserAverage[];
        // Normalize and sort
        const normalized = result
          .map((r) => ({
            id: r.id,
            avg: Math.round(r.avg * 100) / 100,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));

        resolve({ result: normalized, latencyMs });
      } catch (parseError) {
        resolve({
          result: null,
          latencyMs,
          error: `Failed to parse output: ${stdout.substring(0, 200)}`,
        });
      }
    });

    child.on("error", (err) => {
      const endTime = performance.now();
      resolve({
        result: null,
        latencyMs: Math.round(endTime - startTime),
        error: err.message,
      });
    });
  });
}

// Read events from Avro file
async function readAvroFile(filepath: string): Promise<Event[]> {
  return new Promise((resolve, reject) => {
    const events: Event[] = [];
    const decoder = avro.createFileDecoder(filepath);
    decoder.on("data", (record: Event) => events.push(record));
    decoder.on("end", () => resolve(events));
    decoder.on("error", reject);
  });
}

// Compare results
function compareResults(
  expected: UserAverage[],
  actual: UserAverage[] | null
): {
  match: boolean;
  correctCount: number;
  totalCount: number;
  accuracy: number;
} {
  if (!actual) {
    return { match: false, correctCount: 0, totalCount: expected.length, accuracy: 0 };
  }

  let correctCount = 0;
  for (const exp of expected) {
    const act = actual.find((a) => a.id === exp.id);
    if (act && Math.abs(act.avg - exp.avg) < 0.1) {
      correctCount++;
    }
  }

  return {
    match: correctCount === expected.length && actual.length === expected.length,
    correctCount,
    totalCount: expected.length,
    accuracy: Math.round((correctCount / expected.length) * 100),
  };
}

// Main function
async function main() {
  console.log("🤖 LLM Code Generation Test");
  console.log("═".repeat(60));
  console.log("\nThis test asks GPT-5.1 to generate TypeScript code, then");
  console.log("executes it via Bun on various dataset sizes.\n");

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Error: OPENAI_API_KEY environment variable not set");
    console.log("\nRun with: OPENAI_API_KEY=sk-... bun scripts/llm-codegen-test.ts");
    process.exit(1);
  }

  // Check if data files exist
  const dataDir = join(import.meta.dir, "..", "data");
  if (!existsSync(dataDir)) {
    console.error('❌ Error: No data directory found. Run "bun run generate" first.');
    process.exit(1);
  }

  // Step 1: Generate code
  console.log("📝 Step 1: Asking LLM to generate code...\n");
  const codeResult = await generateCode();

  if (codeResult.error) {
    console.error(`❌ Error generating code: ${codeResult.error}`);
    process.exit(1);
  }

  console.log("─".repeat(60));
  console.log("Generated code:");
  console.log("─".repeat(60));
  console.log(codeResult.code);
  console.log("─".repeat(60));
  console.log(`\n   Tokens used: ${codeResult.tokensUsed}`);
  console.log(`   Generation time: ${codeResult.latencyMs}ms\n`);

  // Step 2: Execute on each dataset size
  console.log("🚀 Step 2: Executing generated code on datasets...\n");

  const results: Array<{
    size: number;
    execTime: number;
    accuracy: number;
    success: boolean;
    error?: string;
  }> = [];

  for (const size of TEST_SIZES) {
    const suffix =
      size >= 1_000_000
        ? `${size / 1_000_000}m`
        : size >= 1_000
          ? `${size / 1_000}k`
          : `${size}`;
    const avroFile = join(dataDir, `events-${suffix}.avro`);

    if (!existsSync(avroFile)) {
      console.log(`   ⚠️ Skipping ${size.toLocaleString()} events (file not found)`);
      continue;
    }

    console.log(`   Testing with ${size.toLocaleString()} events...`);

    // Read the actual Avro file to compute the correct answer
    const events = await readAvroFile(avroFile);
    const correctAnswer = computeCorrectAnswer(events);

    // Execute the LLM-generated code
    const execResult = await executeGeneratedCode(codeResult.code, avroFile);

    if (execResult.error) {
      console.log(`   ❌ Error: ${execResult.error}`);
      results.push({
        size,
        execTime: execResult.latencyMs,
        accuracy: 0,
        success: false,
        error: execResult.error,
      });
      continue;
    }

    // Compare the LLM-generated code's output with the correct answer
    const comparison = compareResults(correctAnswer, execResult.result);

    const status = comparison.match ? "✅" : "⚠️";
    console.log(`   ${status} Executed in ${execResult.latencyMs}ms (${comparison.accuracy}% accuracy)`);

    results.push({
      size,
      execTime: execResult.latencyMs,
      accuracy: comparison.accuracy,
      success: comparison.match,
    });
  }

  // Summary table
  console.log("\n" + "═".repeat(60));
  console.log("📋 SUMMARY: Code Generation Approach");
  console.log("═".repeat(60));

  console.log(`\n   Code generation: ${codeResult.tokensUsed} tokens, ${codeResult.latencyMs}ms`);
  console.log("   (Generated once, executed on all datasets)\n");

  console.log("| Dataset   | Exec Time | Accuracy | Status |");
  console.log("|-----------|-----------|----------|--------|");

  for (const r of results) {
    const sizeStr = r.size >= 1_000_000
      ? `${r.size / 1_000_000}M`
      : r.size >= 1_000
        ? `${r.size / 1_000}K`
        : `${r.size}`;
    const status = r.error ? "❌ Error" : r.success ? "✅" : "⚠️";
    console.log(
      `| ${sizeStr.padEnd(9)} | ${(r.execTime + "ms").padStart(9)} | ${(r.accuracy + "%").padStart(8)} | ${status.padEnd(6)} |`
    );
  }

  console.log("\n" + "═".repeat(60));
  console.log("💡 Key insight: ~" + codeResult.tokensUsed + " tokens to generate code");
  console.log("   vs 10,000+ tokens to load data into context");
  console.log("═".repeat(60));
}

main().catch(console.error);
