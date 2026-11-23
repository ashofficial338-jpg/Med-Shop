// The shop works in India time. Day boundaries everywhere on the server -
// "today" on the Dashboard and Day Book, date filters, the daily sales chart -
// use the process time zone, and the host (Render) runs in UTC, 5.5 hours
// behind: a sale at 1 AM counted on the previous day. Imported first by
// server.js, before anything else runs. Date-only values (stored as UTC
// midnight) still fall on the same India calendar day.
process.env.TZ = process.env.SHOP_TZ || "Asia/Kolkata";
