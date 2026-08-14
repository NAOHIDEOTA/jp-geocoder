#!/usr/bin/env node
/**
 * /v1/version.json を生成する（DOC.md §9.5）。
 *
 * 入力: data/abr_catalog.json, data/abr/, data/isj/, data/codh/
 * 出力: dist-data/v1/version.json
 *
 * dist-data は git に入れないので、配信中の物がどの版で作られたかの記録が
 * どこにも残らない。ABR は毎月更新され、後から取り直しても同じ物は手に入らない。
 *
 * 版とするもの:
 *   ABR  手元ファイルの modified 最大値（データセット全体の版番号が無いため）
 *   ISJ  ファイル名の版（19.0b / 24.0a）
 *   CODH 取得日（版表記が無いため）
 */

import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import path from "node:path";

const ABR_DIR = "data/abr";
const ABR_CATALOG = "data/abr_catalog.json";
const ISJ_DIR = "data/isj";
const CODH_DIR = "data/codh";
const OUT_DIR = "dist-data/v1";

/** YYYY-MM-DD。時刻まで出すとタイムゾーンで揺れるので日付で丸める */
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** ディレクトリが無い場合は空配列。取得していない素材があってもビルドは止めない */
async function list(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- ABR

async function abrVersion() {
  const files = new Set(await list(ABR_DIR));
  if (!files.size) return null;

  let catalog = [];
  try {
    catalog = JSON.parse(await readFile(ABR_CATALOG, "utf-8"));
  } catch {
    // カタログが無くてもファイル数だけは記録する
    return { files: files.size, dataUpdated: null };
  }

  // 手元にあるファイルだけを見る。カタログには未取得のものも載っているため。
  // カタログは同じ URL を複数項目で持つことがあるので、項目数ではなく
  // **実ファイル名の集合**で数える（項目数で数えると files を超える）
  let max = 0;
  const matched = new Set();
  for (const item of catalog) {
    const name = path.basename(item.url ?? "");
    if (!name || !files.has(name)) continue;
    matched.add(name);
    if (typeof item.modified === "number" && item.modified > max)
      max = item.modified;
  }

  return {
    files: files.size,
    /** カタログに載っていた手元ファイルの数。files より大きく少なければカタログが古い */
    matched: matched.size,
    dataUpdated: max ? day(max) : null,
  };
}

// ---------------------------------------------------------------- ISJ

async function isjVersion() {
  const files = await list(ISJ_DIR);
  if (!files.length) return null;

  // 01000-19.0b.zip → "19.0b"
  const versions = {};
  for (const f of files) {
    const m = /^\d+-(.+)\.zip$/.exec(f);
    if (!m) continue;
    const v = m[1];
    versions[v] = (versions[v] ?? 0) + 1;
  }
  return { files: files.length, versions };
}

// ---------------------------------------------------------------- CODH

async function codhVersion() {
  const files = await list(CODH_DIR);
  if (!files.length) return null;

  let max = 0;
  for (const f of files) {
    const s = await stat(path.join(CODH_DIR, f));
    if (s.mtimeMs > max) max = s.mtimeMs;
  }
  return { files: files.length, fetched: day(max) };
}

// ---------------------------------------------------------------- 出力

const out = {
  generated: day(Date.now()),
  sources: {
    abr: {
      name: "デジタル庁 アドレス・ベース・レジストリ",
      url: "https://dataset.address-br.digital.go.jp/",
      ...(await abrVersion()),
    },
    isj: {
      name: "国土交通省 位置参照情報",
      url: "https://nlftp.mlit.go.jp/isj/",
      ...(await isjVersion()),
    },
    codh: {
      name: "『歴史的行政区域データセットβ版』（CODH作成）doi:10.20676/00000447",
      url: "https://geoshape.ex.nii.ac.jp/city/",
      ...(await codhVersion()),
    },
  },
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/version.json`, JSON.stringify(out, null, 1));

console.log(`version.json`);
for (const [k, v] of Object.entries(out.sources)) {
  const ver =
    v.dataUpdated ??
    (v.versions && Object.keys(v.versions).join(" / ")) ??
    v.fetched ??
    "不明";
  console.log(
    `  ${k.padEnd(5)} ${String(v.files ?? 0).padStart(5)} ファイル  版: ${ver}`,
  );
}
if (
  out.sources.abr.matched !== undefined &&
  out.sources.abr.matched < out.sources.abr.files
) {
  console.log(
    `  ※ ABR: カタログと照合できたのは ${out.sources.abr.matched}/${out.sources.abr.files}。` +
      `差が大きい場合は make data-part-catalog でカタログを更新すること`,
  );
}
