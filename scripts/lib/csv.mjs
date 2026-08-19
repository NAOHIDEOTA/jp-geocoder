/** ABR の CSV(zip) を展開せずに1行ずつ流す共通ヘルパー。 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** RFC4180 の最小実装 */
export function parseLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** zip 内の CSV を { 列名: 値 } で yield する */
export async function* readZipCsv(zipPath) {
  const unzip = spawn("unzip", ["-p", zipPath]);
  const rl = createInterface({ input: unzip.stdout, crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    if (!line) continue;
    const f = parseLine(line);
    if (!header) {
      header = f;
      continue;
    }
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = f[i] ?? "";
    yield row;
  }
}

/** 非圧縮の CSV を { 列名: 値 } で yield する（ekidata のように zip でない入力用） */
export async function* readCsv(path) {
  const { createReadStream } = await import("node:fs");
  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  let header = null;
  for await (const line of rl) {
    if (!line) continue;
    const f = parseLine(line);
    if (!header) {
      header = f;
      continue;
    }
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = f[i] ?? "";
    yield row;
  }
}
