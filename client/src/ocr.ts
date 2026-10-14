/**
 * On-device text recognition for photos (SPEC 19): Apple's Vision framework,
 * run through osascript, so a photo's text is read on this Mac and no AI
 * service sees the photo first. The backend's screener uses the text to
 * decide whether the photo could be about money at all; only then does Grok
 * vision look at it. Nothing is written to disk.
 */
const SCRIPT = `
ObjC.import('Foundation');
ObjC.import('Vision');
function run(argv) {
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(argv[0]), $({}));
  const request = $.VNRecognizeTextRequest.alloc.init;
  request.recognitionLevel = 1; // fast: enough to spot prices and totals
  if (!handler.performRequestsError($([request]), Ref())) throw new Error('text recognition failed');
  const lines = [];
  const results = request.results;
  for (let i = 0; i < results.count; i++) {
    const best = results.objectAtIndex(i).topCandidates(1);
    if (best.count > 0) lines.push(best.objectAtIndex(0).string.js);
  }
  return lines.join('\\n');
}`;

export async function readText(path: string, timeoutMs = 5_000): Promise<string> {
  const proc = Bun.spawn(["osascript", "-l", "JavaScript", "-e", SCRIPT, path], { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    if (code !== 0) throw new Error(`text recognition failed: ${err.trim().slice(0, 200)}`);
    return out.replace(/\n$/, "");
  } finally {
    clearTimeout(timer);
  }
}
