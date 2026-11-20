/** Tiny `--name value` parser shared by the AIS CLIs. */
export function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function requireAisKey(cli: string): string {
  const key = process.env.AISSTREAM_API_KEY?.trim();
  if (!key) {
    console.error(
      `${cli}: AISSTREAM_API_KEY is not set; add it to .env (free key from aisstream.io)`,
    );
    process.exit(1);
  }
  return key;
}
