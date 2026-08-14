#!/usr/bin/env node
/**
 * 返した座標を外部データと突き合わせて距離を測る。
 * validate.mjs は内部整合性しか見ないので、取り違えはここでしか出ない。
 *
 * 正解データは国交省 位置参照情報（24.0a 街区 / 19.0b 町字）。
 * ABR とは別パイプラインだが元は同じ自治体の台帳なので、独立検証ではない。
 * 符号化のバグは検出できるが、台帳そのものの誤りは両方に同じように現れる。
 *
 * 使い方: node scripts/verify-accuracy.mjs [標本数]
 */

import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import { createGeocoder } from "../../dist/index.js";
import { parseLine } from "../lib/csv.mjs";

const ROOT = "dist-data/v1";
const ISJ = "data/isj";
const SAMPLE = Number(process.argv[2] ?? 3000);

const memo = new Map();
const fetcher = {
  async get(p) {
    if (memo.has(p)) return memo.get(p);
    const q = readFile(`${ROOT}/${p}`, "utf-8").then(JSON.parse);
    memo.set(p, q);
    return q;
  },
};
const geo = createGeocoder({ baseUrl: "local", fetcher, limit: 3 });

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function dist(aLat, aLng, bLat, bLng) {
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** CP932 の zip を1行ずつ返す */
async function* readIsj(file) {
  const buf = await new Promise((resolve, reject) => {
    const p = spawn("unzip", ["-p", file]);
    const chunks = [];
    p.stdout.on("data", (c) => chunks.push(c));
    p.on("close", () => resolve(Buffer.concat(chunks)));
    p.on("error", reject);
  });
  const text = new TextDecoder("shift_jis").decode(buf);
  let header = true;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    if (header) { header = false; continue; }
    yield parseLine(line).map((x) => x.replace(/^"|"$/g, ""));
  }
}

/** 標本を都道府県に散らして取る */
function reservoir(n) {
  const buf = [];
  let seen = 0;
  return {
    push(v) {
      seen++;
      if (buf.length < n) buf.push(v);
      else {
        const j = Math.floor(Math.random() * seen);
        if (j < n) buf[j] = v;
      }
    },
    get items() { return buf; },
    get seen() { return seen; },
  };
}

function report(label, ds, unresolved, wrongLevel) {
  ds.sort((a, b) => a - b);
  const q = (p) => (ds.length ? ds[Math.min(Math.floor(ds.length * p), ds.length - 1)] : 0);
  console.log(`\n[${label}] 照合 ${ds.length.toLocaleString()} 件`);
  console.log(`  中央値 ${q(0.5).toFixed(0)}m / p90 ${q(0.9).toFixed(0)}m / p99 ${q(0.99).toFixed(0)}m / 最大 ${q(1).toFixed(0)}m`);
  const within = (m) => ((ds.filter((d) => d <= m).length / ds.length) * 100).toFixed(1);
  console.log(`  10m以内 ${within(10)}% / 50m以内 ${within(50)}% / 100m以内 ${within(100)}% / 500m以内 ${within(500)}%`);
  console.log(`  解決できず ${unresolved} 件 / 期待した粒度に届かず ${wrongLevel} 件`);
}

// ---------------------------------------------------------------- 街区（番）

{
  const sample = reservoir(SAMPLE);
  for (const f of (await readdir(ISJ)).filter((x) => x.includes("-24.0a"))) {
    for await (const c of readIsj(path.join(ISJ, f))) {
      // 都道府県名, 市区町村名, 大字・丁目名, 小字・通称名, 街区符号, 系番号, X, Y, 緯度, 経度
      const [pref, city, oaza, koaza, blk, , , , lat, lng] = c;
      const la = Number(lat), ln = Number(lng);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
      if (!/^\d+$/.test(blk)) continue; // 地番混じりの行は除く
      sample.push([`${pref}${city}${oaza}${koaza}${blk}`, la, ln]);
    }
  }
  console.log(`街区レベル位置参照情報: ${sample.seen.toLocaleString()} 行から ${sample.items.length.toLocaleString()} 件を抽出`);

  /**
   * 粒度ごとに分けて測る。比較対象の定義が違うため混ぜてはいけない。
   *   block  … ISJ の街区代表点 vs 我々の街区代表点。**同じものを指す**ので近いはず
   *   parcel … ISJ は地番区域の代表点、我々は個々の筆の重心。**別物**なので離れて当然
   *   oaza   … 地番の座標が無くて町字に落ちたもの（データ欠落）
   */
  const byLevel = {};
  const dsBy = { block: [], rsdt: [], parcel: [] };
  let unresolved = 0;
  for (const [addr, la, ln] of sample.items) {
    const r = await geo.geocode(addr);
    const c = r.candidates[0];
    if (!c) { unresolved++; continue; }
    byLevel[c.matchLevel] = (byLevel[c.matchLevel] ?? 0) + 1;
    if (dsBy[c.matchLevel]) dsBy[c.matchLevel].push(dist(c.lat, c.lng, la, ln));
  }
  console.log(`  返した粒度の内訳: ${JSON.stringify(byLevel)} / 解決できず ${unresolved}`);
  report("番（街区）※ISJ と同じものを指す", dsBy.block, 0, 0);
  report("号（ISJ は街区までなので号ぶん離れる）", dsBy.rsdt, 0, 0);
  report("筆（ISJ は地番区域の代表点。定義が違う）", dsBy.parcel, 0, 0);
}

// ---------------------------------------------------------------- 町字

{
  const sample = reservoir(SAMPLE);
  for (const f of (await readdir(ISJ)).filter((x) => x.includes("-19.0b"))) {
    for await (const c of readIsj(path.join(ISJ, f))) {
      // 都道府県コード, 都道府県名, 市区町村コード, 市区町村名, 大字町丁目コード, 大字町丁目名, 緯度, 経度
      const [, pref, , city, , name, lat, lng] = c;
      const la = Number(lat), ln = Number(lng);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
      sample.push([`${pref}${city}${name}`, la, ln]);
    }
  }
  console.log(`\n大字・町丁目レベル位置参照情報: ${sample.seen.toLocaleString()} 行から ${sample.items.length.toLocaleString()} 件を抽出`);

  const ds = [];
  let unresolved = 0, wrongLevel = 0;
  for (const [addr, la, ln] of sample.items) {
    const r = await geo.geocode(addr);
    const c = r.candidates[0];
    if (!c) { unresolved++; continue; }
    if (c.matchLevel !== "oaza") { wrongLevel++; continue; }
    ds.push(dist(c.lat, c.lng, la, ln));
  }
  report("町字", ds, unresolved, wrongLevel);
}

console.log(`
※ 位置参照情報と ABR は元をたどれば同じ自治体の台帳なので、
   これは「独立した第三者検証」ではなく「別経路で作った同種データとの突き合わせ」。
   符号化のバグ・取り違え・座標系の誤りは検出できるが、
   台帳そのものの誤りは両方に同じように現れるため検出できない。`);
