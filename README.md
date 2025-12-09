# LLM Code Generation vs Context Loading Benchmark

A companion project for the blog post: **"Why Embedding a JavaScript Runtime Inside an LLM Is a Big Deal"**

This project demonstrates why having an LLM generate code and execute it via a runtime (like Bun) is superior to loading raw data into the model's context window.

## Key Results

| Approach | 1,000 Events | Tokens | Accuracy |
|----------|--------------|--------|----------|
| **Data in Context** | 7.1s | 10,614 | 0% ❌ |
| **Code Generation** | 37ms | 360* | 100% ✅ |

*\*One-time cost, reused for all dataset sizes*

---

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Generate test data (100 → 1M rows as Avro files)
bun run generate

# 3. Run the local processing benchmark
bun run process

# 4. Test LLM with data in context (requires API key)
OPENAI_API_KEY=sk-... bun run llm-test

# 5. Test LLM code generation approach (requires API key)
OPENAI_API_KEY=sk-... bun run llm-codegen
```

---

## Commands

### `bun run generate`

Generates Avro test data files at 5 different scales:

```
data/
├── events-100.avro    (~1 KB)
├── events-1k.avro     (~9 KB)
├── events-10k.avro    (~86 KB)
├── events-100k.avro   (~854 KB)
└── events-1m.avro     (~8.5 MB)
```

Each event contains:
```typescript
interface Event {
  userId: string;   // "user1" - "user50"
  duration: number; // 10 - 200 ms
}
```

---

### `bun run process`

Runs the processing logic locally on all generated Avro files. This establishes the baseline performance:

```
📁 Processing: events-1m.avro (8.54 MB)
  📖 Read 1,000,000 events in 116ms
  ⚙️  Processed in 74ms
  📊 Results: 50 users with avg duration >= 50
```

**Processing Logic:**
1. Filter events where `duration >= 50`
2. Group by `userId`
3. Calculate average duration per user

---

### `bun run llm-test`

**Tests the "data in context" approach.**

Sends raw event data to GPT-5.1 and asks it to compute the filter/group/average. Tests at increasing scales to demonstrate accuracy degradation.

```
📊 Testing with 10 events
   ✅ Result: CORRECT (100% accuracy)

📊 Testing with 100 events  
   ⚠️ Result: INCORRECT (90% accuracy)

📊 Testing with 1,000 events
   ❌ Result: WRONG (0% accuracy)
```

**Key Insight:** Even the latest GPT-5.1 fails at 1,000 events.

---

### `bun run llm-codegen`

**Tests the "code generation" approach.**

1. Asks GPT-5.1 to generate TypeScript code for the task
2. Writes the generated code to a temp file
3. Executes it via Bun subprocess on each dataset
4. Compares output to the correct answer

```
📝 Generated code (360 tokens):
   const result = Object.entries(
     events.filter(e => e.duration >= 50)
     ...
   );

| Dataset | Exec Time | Accuracy | Status |
|---------|-----------|----------|--------|
| 100     | 44ms      | 100%     | ✅     |
| 1K      | 37ms      | 100%     | ✅     |
| 10K     | 41ms      | 100%     | ✅     |
| 100K    | 58ms      | 100%     | ✅     |
| 1M      | 228ms     | 100%     | ✅     |
```

**Key Insight:** 360 tokens once, perfect accuracy at any scale.

---

### `bun run llm-sort`

**Tests LLM's ability to sort arrays of varying sizes.**

Generates random arrays of integers (1-10,000) and asks GPT-5.1 to sort them. Runs 3 trials per size to show consistency.

```
🔢 LLM Sorting Test (GPT-5.1)

| Size    | Run 1 | Run 2 | Run 3 | Avg Acc |
|---------|-------|-------|-------|---------|
| 10      | 100%  | 100%  | 100%  | 100%    |
| 50      | 100%  |  98%  | 100%  |  99%    |
| 100     |  85%  |  82%  |  80%  |  82%    |
| 500     |  15%  |  12%  |  18%  |  15%    |
| 1K      |   0%  |   0%  |   0%  |   0%    |
| 5K      |   ❌  |   ❌  |   ❌  |   0%    |
| 10K     |   ❌  |   ❌  |   ❌  |   0%    |
```

**Accuracy metric:** Percentage of elements in correct position vs. properly sorted array.

**Key Insight:** Even a simple sorting task degrades rapidly as array size increases.

---

## Project Structure

```
├── blog.md                     # The blog post
├── package.json                # Dependencies & scripts
├── tsconfig.json               # TypeScript config
├── schema/
│   └── event.avsc              # Avro schema definition
├── scripts/
│   ├── generate-data.ts        # Data generator
│   ├── llm-context-test.ts     # LLM data-in-context test
│   ├── llm-codegen-test.ts     # LLM code-generation test
│   └── llm-sort.ts             # LLM sorting accuracy test
├── src/
│   └── process-events.ts       # Local processing benchmark
├── data/                       # Generated .avro files (gitignored)
└── .temp/                      # Temp files for code execution (gitignored)
```

---

## Environment Variables

| Variable | Required For | Description |
|----------|--------------|-------------|
| `OPENAI_API_KEY` | `llm-test`, `llm-codegen`, `llm-sort` | Your OpenAI API key |

---

## Dependencies

- [Bun](https://bun.sh) - Fast JavaScript runtime with native TypeScript
- [avsc](https://www.npmjs.com/package/avsc) - Avro serialization for JavaScript
- [openai](https://www.npmjs.com/package/openai) - OpenAI API client

---

## The Thesis

> **"The model should describe the computation, not perform it."**

LLMs are pattern matchers, not calculators. When you need to process data:
- ❌ Don't load data into the context window
- ✅ Have the LLM generate code, then execute it in a runtime

This project provides empirical evidence for this approach.
