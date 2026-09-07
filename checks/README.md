# JewelOS — automated checks

Seven small programs that read the JewelOS source code and look for a specific
family of mistakes: something the code refers to that was never actually created.
That kind of mistake breaks a whole section of the app silently — no error
message, the section just stops working or goes blank.

They only read files. They never change the app, never touch the shop's data,
and never connect to anything.

---

## If you are the shop owner

You don't need to run these yourself. Just tell your next AI session:

> There are checking scripts in my Downloads folder under `jewelos-checks`.
> Read the README there and run them against the new build before we change anything.

That's all. It saves the session an hour of rebuilding them.

---

## If you are an AI session picking this up

Run every check against an unpacked JewelOS build (the folder containing
`index.html` and `js/`):

```
cd /path/to/jewelos-checks
node scope.js        /path/to/build
node handlers.js     /path/to/build   # needs scope.js run first — it reads globals.json
node css.js          /path/to/build
node ids.js          /path/to/build
node loadorder.js    /path/to/build
node backup-check.js /path/to/build
node roundtrip.js    /path/to/build
```

`node_modules` (acorn) is bundled, so it works offline.

### What each one looks for

| Script | Finds |
|---|---|
| `scope.js` | Variables and functions used but never declared anywhere. Writes `globals.json` for `handlers.js`. |
| `handlers.js` | Buttons whose `onclick` calls a function that doesn't exist — dead buttons. |
| `css.js` | CSS classes applied in markup but never styled. |
| `ids.js` | Element ids the code looks up that no markup ever creates. |
| `loadorder.js` | Startup code reading a global that a later `<script>` tag defines. |
| `backup-check.js` | Drift between what the backup saves and what the restore reads back. |
| `roundtrip.js` | Proves data survives export → wipe → restore, using the real source. |

### Reading the output

Not every hit is a bug. Judge each one:

- **Externally loaded libraries** (`html2canvas`, `Razorpay`) are fine when guarded
  by `typeof X === 'undefined'` and loaded from a CDN on demand.
- **Browser built-ins** may be missing from `scope.js`'s allow-list — add them.
- **CSS classes with no styles** are often deliberate `querySelector` markers, or
  the element is styled inline. Check before reporting.
- **Ids built by joining strings** (`'oi-desc-' + i`) can't be resolved statically
  and show up as false positives in `ids.js`.
- The real signal in `css.js` is the **"HIGH SIGNAL"** section: a class whose
  siblings in the same family *are* styled, but this one isn't.

`backup-check.js` and `roundtrip.js` should both pass cleanly. If `roundtrip.js`
reports lost keys, the backup is silently dropping shop data — treat as urgent.

### Known false positives as of Sept 2026

`scope.js` flags `TextEncoder`, `html2canvas` and `Razorpay`; all three are fine.
Its "implicit globals" list also flags reassigned function parameters — ignore
those; only names that are never declared *and* never a parameter matter.

---

## History

Built Sept 2026, after three bugs of this kind (`ordItems`, `ORD_STATUS`, and the
`.ord-st-*` styles) each silently broke an entire section. Sweeping the whole
codebase then found nine more:

- `changeNote` — crashed saving any Girvi loan edit
- `.mtab-s` — neither metal tab showed which was selected
- `.pay-hist-item`, `.pay-hist-badge`, `.edit-history-row` — unstyled history rows
- `--surface2`, `--gold-mid` — undefined colours, so those rules were dropped
- `#of-goldpurity` — priced every gold deposit as 22K regardless of actual purity
- `#add-prod-btn` — dashboard "Add product" went nowhere
- **the backup** — saved 12 things, restored 10, and silently destroyed customers,
  purchase bills and suppliers on restore
