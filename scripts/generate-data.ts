import avro from "avsc";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

// Define the Event type
interface Event {
  userId: string;
  duration: number;
}

// Load the Avro schema
const eventType = avro.Type.forSchema({
  type: "record",
  name: "Event",
  namespace: "com.example.events",
  fields: [
    { name: "userId", type: "string" },
    { name: "duration", type: "int" },
  ],
});

// Configuration
const NUM_USERS = 50;
const MIN_DURATION = 10;
const MAX_DURATION = 200;
const DATA_SIZES = [100, 1_000, 10_000, 100_000, 1_000_000];

// Generate a random event
function generateEvent(): Event {
  const userId = `user${Math.floor(Math.random() * NUM_USERS) + 1}`;
  const duration =
    Math.floor(Math.random() * (MAX_DURATION - MIN_DURATION + 1)) + MIN_DURATION;
  return { userId, duration };
}

// Generate events and write to Avro file
async function generateAvroFile(count: number, filename: string): Promise<void> {
  const dataDir = join(import.meta.dir, "..", "data");

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const filepath = join(dataDir, filename);
  const encoder = avro.createFileEncoder(filepath, eventType);

  console.log(`Generating ${count.toLocaleString()} events to ${filename}...`);
  const startTime = performance.now();

  for (let i = 0; i < count; i++) {
    encoder.write(generateEvent());
  }

  // Wait for the encoder to finish
  await new Promise<void>((resolve, reject) => {
    encoder.end();
    encoder.on("finish", resolve);
    encoder.on("error", reject);
  });

  const endTime = performance.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // Get file size
  const file = Bun.file(filepath);
  const size = file.size;
  const sizeStr =
    size > 1_000_000
      ? `${(size / 1_000_000).toFixed(2)} MB`
      : `${(size / 1_000).toFixed(2)} KB`;

  console.log(`  ✓ Created ${filename} (${sizeStr}) in ${duration}s`);
}

// Main function
async function main() {
  console.log("🚀 Avro Data Generator\n");
  console.log(`Configuration:`);
  console.log(`  - Users: ${NUM_USERS}`);
  console.log(`  - Duration range: ${MIN_DURATION}-${MAX_DURATION}`);
  console.log(`  - Sizes: ${DATA_SIZES.map((n) => n.toLocaleString()).join(", ")}\n`);

  for (const size of DATA_SIZES) {
    const suffix =
      size >= 1_000_000
        ? `${size / 1_000_000}m`
        : size >= 1_000
          ? `${size / 1_000}k`
          : `${size}`;
    const filename = `events-${suffix}.avro`;
    await generateAvroFile(size, filename);
  }

  console.log("\n✅ All data files generated successfully!");
}

main().catch(console.error);
