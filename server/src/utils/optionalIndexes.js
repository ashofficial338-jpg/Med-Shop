import User from "../models/User.js";
import Customer from "../models/Customer.js";

// User email and customer phone are optional but must stay unique when
// given. Older databases have a plain unique index on them (where two blanks
// collide), so it is swapped for a partial unique index that ignores missing
// values. Existing records are kept; blank values are unset so they don't
// count. Idempotent - safe on every boot.
async function partialUnique(model, field) {
  const coll = model.collection;
  const indexes = await coll.indexes().catch(() => []);
  const current = indexes.find((i) => i.key && Object.keys(i.key).length === 1 && i.key[field] === 1);
  const wanted = { [field]: { $type: "string" } };
  if (current && current.unique && JSON.stringify(current.partialFilterExpression) === JSON.stringify(wanted)) return;
  await coll.updateMany({ [field]: { $in: ["", null] } }, { $unset: { [field]: "" } });
  if (current) await coll.dropIndex(current.name);
  await coll.createIndex({ [field]: 1 }, { unique: true, partialFilterExpression: wanted, name: `${field}_1` });
  console.log(`Index ${model.collection.collectionName}.${field} is now unique-when-present.`);
}

export async function ensureOptionalIndexes() {
  await partialUnique(User, "email");
  await partialUnique(Customer, "phone");
}
