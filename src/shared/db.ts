import { MongoClient, Db, ClientSession } from "mongodb";
import { rootLogger } from "./logger";

const logger = rootLogger.child({});

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * Returns a connected Db instance, reusing the existing connection across
 * warm Lambda invocations (module-level singleton pattern).
 */
export async function getDb(): Promise<Db> {
  if (db) {
    return db;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  logger.info("Establishing new MongoDB connection");

  client = new MongoClient(uri, {
    // Keep connections alive across Lambda invocations
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 30000,
  });

  await client.connect();

  // Extract database name from the URI; fall back to "ecommerce"
  const dbName = new URL(uri).pathname.replace(/^\//, "") || "ecommerce";
  db = client.db(dbName);

  logger.info("MongoDB connection established", { dbName });

  return db;
}

/**
 * Close the connection — useful in tests and graceful shutdown scenarios.
 */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info("MongoDB connection closed");
  }
}

export async function runInTransaction<T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  await getDb();

  if (!client) {
    throw new Error("MongoDB client is not initialized");
  }

  const session = client.startSession();
  let hasResult = false;
  let result!: T;

  try {
    await session.withTransaction(async () => {
      result = await work(session);
      hasResult = true;
    });
  } finally {
    await session.endSession();
  }

  if (!hasResult) {
    throw new Error("Transaction completed without returning a result");
  }

  return result;
}
