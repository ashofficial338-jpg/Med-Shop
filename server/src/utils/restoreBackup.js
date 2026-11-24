import "../tz.js";
import "dotenv/config";
import fs from "node:fs";
import mongoose from "mongoose";
import { runInTransaction } from "./transaction.js";
import { restoreBackup } from "./transactionReset.js";

// npm run restore -- "C:\path\GuganMedicals_Backup_2026-11-24.json"
// Puts back a backup downloaded from Clear All Transaction Records. Refused if
// anything has been entered since clearing. User accounts are never touched.
const file = process.argv[2];
if (!file) {
  console.error('Give the backup file: npm run restore -- "path to backup.json"');
  process.exit(1);
}
try {
  const backup = mongoose.mongo.BSON.EJSON.parse(fs.readFileSync(file, "utf8"), { relaxed: true });
  await mongoose.connect(process.env.MONGO_URI);
  await runInTransaction(() => restoreBackup(backup));
  console.log(`Restored the backup of ${new Date(backup.createdAt).toLocaleString("en-IN")}.`);
  await mongoose.disconnect();
} catch (e) {
  console.error(`Nothing was restored: ${e.message}`);
  process.exit(1);
}
