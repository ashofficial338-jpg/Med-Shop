import mongoose from "mongoose";

// All-or-nothing saves. A purchase or a bill touches many records - stock
// totals, batches, rack positions, the stock ledger, balances, payments. They
// are written in one MongoDB transaction, so either every one of them is
// updated or none is: a crash, a dropped connection or a failed check halfway
// can never leave stock and accounts disagreeing. (Needs a replica set, which
// every MongoDB Atlas cluster is.)
//
// With this option on, every Mongoose call made inside the callback joins the
// transaction by itself - no session has to be passed around.
mongoose.set("transactionAsyncLocalStorage", true);

// Runs `fn` in a transaction and returns its result. MongoDB runs it again
// when another save touched the same records at the same moment, so `fn` must
// read everything it uses itself.
export function runInTransaction(fn) {
  let result;
  return mongoose.connection
    .transaction(async () => {
      result = await fn();
    })
    .then(() => result);
}

class Refused extends Error {}

// Wraps a route handler: it runs in a transaction, and answering with an error
// status (400, 409, ...) undoes everything it wrote. The answer is only sent
// once the transaction has been committed.
export function transactional(handler) {
  return async (req, res) => {
    let reply = null;
    try {
      await runInTransaction(async () => {
        reply = null;
        const held = {
          code: 200,
          status(code) {
            this.code = code;
            return this;
          },
          json(body) {
            reply = { code: this.code, body };
            return this;
          },
        };
        await handler(req, held);
        if (!reply || reply.code >= 400) throw new Refused();
      });
    } catch (e) {
      if (!(e instanceof Refused) || !reply) throw e;
    }
    res.status(reply.code).json(reply.body);
  };
}

// For a handler's own catch block: these errors mean "another save was
// touching the same records - run the transaction again", so they must reach
// runInTransaction rather than be answered as a failure.
export function rethrowIfRetryable(e) {
  if (e?.hasErrorLabel?.("TransientTransactionError") || e?.hasErrorLabel?.("UnknownTransactionCommitResult")) throw e;
}

// Was this duplicate-key error about `field`?
export const isDuplicateOf = (e, field) => e?.code === 11000 && Boolean(e.keyPattern && field in e.keyPattern);

// Each form on screen sends one id with every attempt to save it. A repeat of
// an already-saved form (Save pressed twice, or a slow connection that lost
// the answer) is recognised by it and never recorded a second time.
export function cleanClientRef(value) {
  const ref = String(value ?? "").trim();
  return /^[\w-]{8,64}$/.test(ref) ? ref : "";
}
