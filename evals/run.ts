/**
 * `npm run eval -- --suite extraction|qa ...`: dispatches to the suite's runner (extraction when
 * `--suite` is absent, as before).
 */
const argv = process.argv.slice(2);
const at = argv.indexOf("--suite");
const suite = at >= 0 ? argv[at + 1] : "extraction";

try {
  if (suite === "qa") {
    await (await import("./qa/run.js")).main(argv);
  } else if (suite === "extraction") {
    await (await import("./extraction/run.js")).main();
  } else {
    throw new Error(`unknown suite "${suite}": extraction or qa`);
  }
} catch (err) {
  console.error(`[eval] ${(err as Error).message}`);
  process.exit(1);
}
