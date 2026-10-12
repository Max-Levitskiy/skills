// Preloaded into the helper so it starts under a Bun that reports another version.
process.versions.bun = process.env.FAKE_BUN_VERSION ?? "1.1.0";
