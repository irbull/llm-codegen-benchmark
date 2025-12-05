import OpenAI from "openai";

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
const TEST_SIZES = [10, 100, 1_000, 10_000];

// Generate random events
function generateEvents(count: number): Event[] {
  const events: Event[] = [];
  for (let i = 0; i < count; i++) {
    events.push({
      userId: `user${Math.floor(Math.random() * NUM_USERS) + 1}`,
      duration: Math.floor(Math.random() * (MAX_DURATION - MIN_DURATION + 1)) + MIN_DURATION,
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

// Ask LLM to compute the answer
async function askLLMToCompute(events: Event[]): Promise<{
  success: boolean;
  result: UserAverage[] | null;
  tokensUsed: number;
  latencyMs: number;
  error?: string;
}> {
  const eventsJson = JSON.stringify(events);
  
  const prompt = `You are given an array of events. Each event has a userId (string) and duration (number in milliseconds).

Task:
1. Filter out events where duration < 50
2. Group the remaining events by userId
3. Calculate the average duration for each user
4. Return the result as a JSON array with objects containing "id" and "avg" (rounded to 2 decimal places)

IMPORTANT: Return ONLY the JSON array, no explanation or markdown.

Events data:
${eventsJson}`;

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
    
    // Try to parse the JSON response
    try {
      // Clean up the response (remove markdown code blocks if present)
      let jsonStr = content.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      }
      
      const result = JSON.parse(jsonStr) as UserAverage[];
      // Normalize and sort for comparison
      const normalized = result.map(r => ({
        id: r.id,
        avg: Math.round(r.avg * 100) / 100
      })).sort((a, b) => a.id.localeCompare(b.id));
      
      return { success: true, result: normalized, tokensUsed, latencyMs };
    } catch (parseError) {
      return { 
        success: false, 
        result: null, 
        tokensUsed, 
        latencyMs, 
        error: `Failed to parse response: ${content.substring(0, 200)}...` 
      };
    }
  } catch (apiError: any) {
    const endTime = performance.now();
    return { 
      success: false, 
      result: null, 
      tokensUsed: 0, 
      latencyMs: Math.round(endTime - startTime), 
      error: apiError.message 
    };
  }
}

// Compare results
function compareResults(expected: UserAverage[], actual: UserAverage[] | null): {
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
    const act = actual.find(a => a.id === exp.id);
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
  console.log("🧪 LLM Context Loading Test");
  console.log("═".repeat(60));
  console.log("\nThis test sends raw event data to GPT-5.1 and asks it to");
  console.log("compute: filter(duration >= 50) → groupBy(userId) → average\n");

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Error: OPENAI_API_KEY environment variable not set");
    console.log("\nRun with: OPENAI_API_KEY=sk-... bun scripts/llm-context-test.ts");
    process.exit(1);
  }

  const results: Array<{
    size: number;
    tokensUsed: number;
    latencyMs: number;
    accuracy: number;
    success: boolean;
    error?: string;
  }> = [];

  for (const size of TEST_SIZES) {
    console.log(`\n📊 Testing with ${size.toLocaleString()} events`);
    console.log("─".repeat(60));

    // Generate events
    const events = generateEvents(size);
    const correctAnswer = computeCorrectAnswer(events);
    
    console.log(`   Generated ${events.length} events`);
    console.log(`   Correct answer has ${correctAnswer.length} users with avg duration >= 50`);
    console.log(`   Approximate tokens: ~${(JSON.stringify(events).length / 4).toLocaleString()}`);

    // Ask LLM
    console.log(`   Sending to GPT-5.1...`);
    const llmResult = await askLLMToCompute(events);

    if (llmResult.error) {
      console.log(`   ❌ Error: ${llmResult.error}`);
      results.push({
        size,
        tokensUsed: llmResult.tokensUsed,
        latencyMs: llmResult.latencyMs,
        accuracy: 0,
        success: false,
        error: llmResult.error,
      });
      continue;
    }

    // Compare results
    const comparison = compareResults(correctAnswer, llmResult.result);

    console.log(`   Tokens used: ${llmResult.tokensUsed.toLocaleString()}`);
    console.log(`   Latency: ${llmResult.latencyMs.toLocaleString()}ms`);
    console.log(`   Accuracy: ${comparison.accuracy}% (${comparison.correctCount}/${comparison.totalCount} users correct)`);
    
    if (comparison.match) {
      console.log(`   ✅ Result: CORRECT`);
    } else {
      console.log(`   ⚠️  Result: INCORRECT or PARTIAL`);
    }

    results.push({
      size,
      tokensUsed: llmResult.tokensUsed,
      latencyMs: llmResult.latencyMs,
      accuracy: comparison.accuracy,
      success: comparison.match,
    });
  }

  // Summary table
  console.log("\n" + "═".repeat(60));
  console.log("📋 SUMMARY: LLM Data-in-Context Results");
  console.log("═".repeat(60));
  console.log("\n| Events | Tokens | Latency | Accuracy | Status |");
  console.log("|--------|--------|---------|----------|--------|");
  
  for (const r of results) {
    const status = r.error ? "❌ Error" : r.success ? "✅ Correct" : "⚠️ Wrong";
    console.log(
      `| ${r.size.toLocaleString().padStart(6)} | ${r.tokensUsed.toLocaleString().padStart(6)} | ${(r.latencyMs + "ms").padStart(7)} | ${(r.accuracy + "%").padStart(8)} | ${status} |`
    );
  }

  console.log("\n" + "═".repeat(60));
  console.log("💡 Compare this to the Avro/code-generation approach:");
  console.log("   - 1M events processed in ~190ms");
  console.log("   - 100% accuracy (deterministic code execution)");
  console.log("   - Tokens used: ~50 (just the code snippet)");
  console.log("═".repeat(60));
}

main().catch(console.error);
