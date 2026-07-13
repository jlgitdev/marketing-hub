import { ensureDataDirectories, getDatabase } from "../src/server/db/database";

const root = ensureDataDirectories();
getDatabase();
console.log(`Marketing Hub database initialized at ${root}`);
