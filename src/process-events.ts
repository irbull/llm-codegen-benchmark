import avro from "avsc";
import { readdirSync } from "fs";
import { join } from "path";

// Define the Event type
interface Event {
  userId: string;
  duration: number;
}

// Result type after processing
interface UserAverage {
  id: string;
  avg: number;
}

// Avro schema type
const eventType = avro.Type.forSchema({
  type: "record",
  name: "Event",
  namespace: "com.example.events",
  fields: [
    { name: "userId", type: "string" },
    { name: "duration", type: "int" },
  ],
});

// Read all events from an Avro file
async function readAvroFile(filepath: string): Promise<Event[]> {
  return new Promise((resolve, reject) => {
    const events: Event[] = [];
    const decoder = avro.createFileDecoder(filepath);

    decoder.on("data", (record: Event) => {
      events.push(record);
    });

    decoder.on("end", () => {
      resolve(events);
    });

    decoder.on("error", (err: Error) => {
      reject(err);
    });
  });
}

// Process events using the blog's logic
function processEvents(events: Event[]): UserAverage[] {
  // Filter: only events with duration >= 50
  const filtered = events.filter((e) => e.duration >= 50);

  // Group by userId
  const grouped = Object.groupBy(filtered, (e) => e.userId);

  // Calculate average duration per user
  const result = Object.entries(grouped).map(([id, group]) => ({
    id,
    avg: group!.reduce((a, b) => a + b.duration, 0) / group!.length,
  }));

  return result;
}

// Benchmark a single file
async function benchmarkFile(filename: string): Promise<void> {
  const dataDir = join(import.meta.dir, "..", "data");
  const filepath = join(dataDir, filename);

  // Get file size
  const file = Bun.file(filepath);
  const size = file.size;
  const sizeStr =
    size > 1_000_000
      ? `${(size / 1_000_000).toFixed(2)} MB`
      : `${(size / 1_000).toFixed(2)} KB`;

  console.log(`\n📁 Processing: ${filename} (${sizeStr})`);
  console.log("─".repeat(50));

  // Benchmark: Read file
  const readStart = performance.now();
  const events = await readAvroFile(filepath);
  const readEnd = performance.now();
  const readTime = (readEnd - readStart).toFixed(2);

  console.log(`  📖 Read ${events.length.toLocaleString()} events in ${readTime}ms`);

  // Benchmark: Process data
  const processStart = performance.now();
  const result = processEvents(events);
  const processEnd = performance.now();
  const processTime = (processEnd - processStart).toFixed(2);

  console.log(`  ⚙️  Processed in ${processTime}ms`);
  console.log(`  📊 Results: ${result.length} users with avg duration >= 50`);

  // Show sample results (first 3 users)
  console.log(`  📝 Sample results:`);
  result
    .slice(0, 3)
    .forEach((r) => console.log(`     - ${r.id}: avg ${r.avg.toFixed(2)}ms`));

  // Total time
  const totalTime = (parseFloat(readTime) + parseFloat(processTime)).toFixed(2);
  console.log(`  ⏱️  Total time: ${totalTime}ms`);
}

// Main function
async function main() {
  console.log("🚀 Avro Event Processing Benchmark");
  console.log("═".repeat(50));
  console.log("\nProcessing logic:");
  console.log("  1. Filter events where duration >= 50");
  console.log("  2. Group by userId");
  console.log("  3. Calculate average duration per user");

  const dataDir = join(import.meta.dir, "..", "data");

  // Get all .avro files sorted by size
  const files = readdirSync(dataDir)
    .filter((f) => f.endsWith(".avro"))
    .sort((a, b) => {
      // Sort by numeric size in filename
      const getSize = (name: string): number => {
        const match = name.match(/events-(\d+)(k|m)?\.avro/);
        if (!match) return 0;
        const num = parseInt(match[1]);
        const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
        return num * multiplier;
      };
      return getSize(a) - getSize(b);
    });

  if (files.length === 0) {
    console.log("\n❌ No .avro files found in data/ directory.");
    console.log('   Run "bun run generate" first to create test data.');
    return;
  }

  console.log(`\nFound ${files.length} data files to process...`);

  // Process each file
  for (const file of files) {
    await benchmarkFile(file);
  }

  console.log("\n" + "═".repeat(50));
  console.log("✅ Benchmark complete!");
}

main().catch(console.error);
