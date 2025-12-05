
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
  const result = Object.entries(
  events
    .filter(event => event.duration >= 50)
    .reduce<Record<string, { sum: number; count: number }>>((acc, { userId, duration }) => {
      if (!acc[userId]) {
        acc[userId] = { sum: 0, count: 0 };
      }
      acc[userId].sum += duration;
      acc[userId].count += 1;
      return acc;
    }, {})
).map(([id, { sum, count }]) => ({
  id,
  avg: Math.round((sum / count) * 100) / 100
})).sort((a, b) => a.id.localeCompare(b.id));
  // === LLM-GENERATED CODE END ===
  
  // Output the result as JSON
  console.log(JSON.stringify(result));
}

main().catch(console.error);
