# Invoice Saver

Saves a PDF and an Excel copy of every sale and purchase to this PC:

```
reports\sales\<Year>\<Month>\<DD-MM-YYYY>\SALES-001.pdf / SALES-001.xlsx
reports\purchase\<Year>\<Month>\<DD-MM-YYYY>\PUR-001.pdf / PUR-001.xlsx
```

The backend runs on Render and can't write to this PC, so this small program
(Node.js only, nothing to install) checks every 10 seconds for new invoices and
saves them. SALES-/PUR- numbers come from the server: continuous, never reused.
An existing file is never overwritten. Folders are created automatically.

## Setup (once)

1. Copy `.env.example` to `.env` here and enter an **Admin** email and password.
2. Double-click `start-invoice-saver.bat` (keep the window open, or minimise it).
3. To start it with Windows: press `Win + R`, type `shell:startup`, and put a
   shortcut to `start-invoice-saver.bat` in that folder.

`node saver.mjs --once` saves everything pending and exits.

If the PC is off, nothing is lost: invoices made meanwhile are saved the next
time the saver runs (into the folder for the day they were made).
