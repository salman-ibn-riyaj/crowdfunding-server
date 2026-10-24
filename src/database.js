import { MongoClient } from "mongodb";
import { config } from "./config.js";

const client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
const database = client.db(config.mongoDbName);
let connectionPromise;

export function getMongoClient() {
    return client;
}

export function getDatabase() {
    return database;
}

export async function connectToDatabase() {
    connectionPromise ??= client.connect().then(async () => {
        await database.command({ ping: 1 });
        return database;
    }).catch((error) => {
        connectionPromise = undefined;
        throw error;
    });

    return connectionPromise;
}

export async function closeDatabase() {
    connectionPromise = undefined;
    await client.close();
}