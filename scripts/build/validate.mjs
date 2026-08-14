#!/usr/bin/env node
/**
 * 配信物の検証ゲート（DOC.md §9.3）。壊れたデータを公開しないための関門。
 *
 * A. 物理的にありえないものは絶対値で落とす（日本の外・Pages の制限・件数の急減）
 * B. 外れ値は前回ビルドとの比較で落とす。絶対閾値では正しいデータと区別できない
 *    （代表点から60km超の町字は12市町村あるが全て離島で正しい）。
 *    「この回で外れ値が増えたか」が正しい問い。
 *
 * 使い方:
 *   node scripts/validate.mjs             検証して metrics.json を更新
 *   node scripts/validate.mjs --no-write  検証のみ
 */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";

const ROOT = "dist-data/v1";
const METRICS = "dist-data/metrics.json";
const WRITE = !process.argv.includes("--no-write");

/** 日本の外接矩形。沖ノ鳥島(20.43N) と 南鳥島(153.98E) を含む */
const JAPAN = { minLat: 20.0, maxLat: 45.8, minLng: 122.8, maxLng: 154.1 };

const LIMITS = {
  /** 外れ値として数え上げる基準（落とす基準ではない） */
  rsdtFromBlock: 500,
  townFromCity: 60_000,
  prefMargin: 0.6,
  /** 外れ値が前回より何%増えたら落とすか */
  outlierGrowth: 20,
  /**
   * 号と街区の距離の中央値が前回から何%動いたら落とすか。
   *
   * 外れ値の件数だけでは感度が足りない（自己テストで、号3,000件の差分を10倍にしても
   * 外れ値は +5.8% しか増えず素通りした）。差分エンコードのスケールを間違えると
   * **分布全体がまるごと動く**ので、中央値のほうが桁違いに敏感に反応する。
   */
  medianShift: 25,
  /** 号が街区から離れうる物理的な上限。これを超えたら無条件で落とす */
  rsdtHardCap: 5000,
  /** カバレッジが前回より落ちてよい幅（ポイント） */
  coverageDrop: 0.5,
  /** 件数が前回より落ちてよい割合（%） */
  countDrop: 1,
  /** Cloudflare Pages の制限 */
  maxFiles: 20_000,
  maxFileBytes: 25 * 1024 * 1024,
};

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function dist(aLat, aLng, bLat, bLng) {
  const dLat = rad(bLat - aLat),
    dLng = rad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);

// ---------------------------------------------------------------- 基準データ

const cities = JSON.parse(await readFile(`${ROOT}/cities.json`, "utf-8"));
const cityPos = new Map();
const prefBox = new Map();
for (const c of cities.cities) {
  if (c.lat === undefined || c.lng === undefined) continue;
  cityPos.set(c.code, { lat: c.lat, lng: c.lng, name: c.name });
  if (c.level === "pref") continue;
  const b = prefBox.get(c.pref) ?? {
    minLat: Infinity,
    maxLat: -Infinity,
    minLng: Infinity,
    maxLng: -Infinity,
  };
  b.minLat = Math.min(b.minLat, c.lat);
  b.maxLat = Math.max(b.maxLat, c.lat);
  b.minLng = Math.min(b.minLng, c.lng);
  b.maxLng = Math.max(b.maxLng, c.lng);
  prefBox.set(c.pref, b);
}
for (const b of prefBox.values()) {
  b.minLat -= LIMITS.prefMargin;
  b.maxLat += LIMITS.prefMargin;
  b.minLng -= LIMITS.prefMargin;
  b.maxLng += LIMITS.prefMargin;
}
console.log(
  `基準: 市区町村代表点 ${cityPos.size.toLocaleString()} 件 / 都道府県 bbox ${prefBox.size} 件\n`,
);

const inJapan = (lat, lng) =>
  lat >= JAPAN.minLat &&
  lat <= JAPAN.maxLat &&
  lng >= JAPAN.minLng &&
  lng <= JAPAN.maxLng;

const metrics = {};

// ---------------------------------------------------------------- 町字

{
  let total = 0,
    withPos = 0;
  const outJapan = [];
  let outPref = 0,
    farFromCity = 0;
  const farCities = new Map();
  const seen = new Set();

  for (const f of await readdir(`${ROOT}/oaza`)) {
    const shard = JSON.parse(await readFile(`${ROOT}/oaza/${f}`, "utf-8"));
    for (const entries of Object.values(shard)) {
      for (const e of entries) {
        const key = `${e[0]}/${e[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        total++;
        // [lg, id, 大字, 丁目, 小字, lat, lng, flags]（src/core/towns.ts の TownEntry）
        const [code, , oaza, chome, koaza, lat, lng] = e;
        const name = `${oaza}${chome ? `${chome}丁目` : ""}${koaza}`;
        if (lat === null || lng === null) continue;
        withPos++;

        if (!inJapan(lat, lng)) {
          if (outJapan.length < 10)
            outJapan.push(`${code} ${name} (${lat},${lng})`);
          continue;
        }
        const box = prefBox.get(code.slice(0, 2));
        if (
          box &&
          (lat < box.minLat ||
            lat > box.maxLat ||
            lng < box.minLng ||
            lng > box.maxLng)
        )
          outPref++;

        const cp = cityPos.get(code);
        if (cp) {
          const d = dist(lat, lng, cp.lat, cp.lng);
          if (d > LIMITS.townFromCity) {
            farFromCity++;
            const cur = farCities.get(code) ?? { name: cp.name, max: 0, n: 0 };
            cur.max = Math.max(cur.max, d);
            cur.n++;
            farCities.set(code, cur);
          }
        }
      }
    }
  }
  metrics.towns = {
    total,
    withPos,
    coverage: +((withPos / total) * 100).toFixed(2),
    outPref,
    farFromCity,
    farCityCount: farCities.size,
  };
  console.log(
    `町字: ${total.toLocaleString()} 件 / 座標あり ${withPos.toLocaleString()} = ${metrics.towns.coverage}%`,
  );
  console.log(
    `  都道府県 bbox 外: ${outPref} 件 / 市区町村から${LIMITS.townFromCity / 1000}km超: ${farFromCity} 件（${farCities.size} 市町村）`,
  );

  const top = [...farCities.entries()]
    .sort((a, b) => b[1].max - a[1].max)
    .slice(0, 5);
  if (top.length) {
    notes.push(
      "遠隔の町字を持つ市町村（離島とみられる。件数が増えていなければ正常）:\n" +
        top
          .map(
            ([c, v]) =>
              `      ${c} ${v.name} 最大${(v.max / 1000).toFixed(0)}km (${v.n}件)`,
          )
          .join("\n"),
    );
  }
  if (outJapan.length) {
    fail(
      `町字の座標が日本の範囲外（座標系の取り違えを疑う）:\n    ${outJapan.join("\n    ")}`,
    );
  } else {
    console.log("  ✔ 日本の範囲内");
  }
}

// ---------------------------------------------------------------- 番・号

{
  let blocks = 0,
    rsdts = 0,
    farFromBlock = 0,
    maxFar = 0,
    maxFarWhat = "";
  const outJapan = [];
  let outPref = 0;
  const overCap = [];
  /** 距離のヒストグラム（5m刻み・3kmまで＋あふれ）。中央値を出すため */
  const BUCKET = 5,
    BUCKETS = 600;
  const hist = new Int32Array(BUCKETS + 1);

  for (const f of (await readdir(`${ROOT}/rsdt`)).filter((x) =>
    x.endsWith(".json"),
  )) {
    const data = JSON.parse(await readFile(`${ROOT}/rsdt/${f}`, "utf-8"));
    const code = data.code;
    const box = prefBox.get(code.slice(0, 2));
    for (const [tid, town] of Object.entries(data.t)) {
      for (const [bnum, blk] of Object.entries(town)) {
        blocks++;
        const [blat, blng] = blk.p;
        if (!inJapan(blat, blng)) {
          if (outJapan.length < 10)
            outJapan.push(`${code}/${tid}/${bnum}番 (${blat},${blng})`);
          continue;
        }
        if (
          box &&
          (blat < box.minLat ||
            blat > box.maxLat ||
            blng < box.minLng ||
            blng > box.maxLng)
        )
          outPref++;

        /**
         * 号は2つの形で入る（build-rsdt.mjs 参照）。両方数えないと件数が激減する。
         *   q: 1..N の連番（実測73%）を配列で
         *   r: 飛び番・枝番をキー付きで
         */
        const entries = [
          ...(blk.q ?? []).map((d, i) => [String(i + 1), d]),
          ...Object.entries(blk.r ?? {}),
        ];
        for (const [num, d] of entries) {
          rsdts++;
          const m = dist(blat + d[0] / 1e6, blng + d[1] / 1e6, blat, blng);
          if (m > maxFar) {
            maxFar = m;
            maxFarWhat = `${code}/${tid}/${bnum}番${num}号`;
          }
          if (m > LIMITS.rsdtFromBlock) farFromBlock++;
          if (m > LIMITS.rsdtHardCap && overCap.length < 10) {
            overCap.push(`${code}/${tid}/${bnum}番${num}号 → ${m.toFixed(0)}m`);
          }
          hist[Math.min(Math.floor(m / BUCKET), BUCKETS)]++;
        }
      }
    }
  }
  /** ヒストグラムから分位点を取る */
  const quantile = (q) => {
    let target = rsdts * q,
      acc = 0;
    for (let i = 0; i <= BUCKETS; i++) {
      acc += hist[i];
      if (acc >= target) return i * BUCKET;
    }
    return BUCKETS * BUCKET;
  };
  metrics.rsdt = {
    blocks,
    rsdts,
    farFromBlock,
    maxDistFromBlock: Math.round(maxFar),
    medianDistFromBlock: quantile(0.5),
    p99DistFromBlock: quantile(0.99),
  };
  console.log(
    `\n番: ${blocks.toLocaleString()} / 号: ${rsdts.toLocaleString()}`,
  );
  console.log(`  都道府県 bbox 外: ${outPref} 件`);
  console.log(
    `  号と街区の距離: 中央値 ${metrics.rsdt.medianDistFromBlock}m / p99 ${metrics.rsdt.p99DistFromBlock}m / 最大 ${maxFar.toFixed(0)}m (${maxFarWhat})`,
  );
  console.log(
    `  ${LIMITS.rsdtFromBlock}m超: ${farFromBlock} 件 = ${((farFromBlock / rsdts) * 100).toFixed(4)}%`,
  );
  if (overCap.length) {
    fail(
      `号が街区から${LIMITS.rsdtHardCap}m超（物理的にありえない。差分エンコードの破損を疑う）:\n    ${overCap.join("\n    ")}`,
    );
  }

  if (outJapan.length) {
    fail(`街区の座標が日本の範囲外:\n    ${outJapan.join("\n    ")}`);
  } else {
    console.log("  ✔ 日本の範囲内");
  }
}

// ---------------------------------------------------------------- 地番

{
  let towns = 0,
    parcels = 0,
    outJapan = [],
    outPref = 0,
    farFromTown = 0;
  let maxFar = 0,
    maxFarWhat = "";
  const SCALE = 1e5;
  const BUCKET = 20,
    BUCKETS = 500; // 20m刻み・10kmまで
  const hist = new Int32Array(BUCKETS + 1);
  const scaleCount = {};

  let dir = [];
  try {
    dir = (await readdir(`${ROOT}/parcel`)).filter((x) => x.endsWith(".json"));
  } catch {
    /* 未生成 */
  }

  for (const f of dir) {
    const data = JSON.parse(await readFile(`${ROOT}/parcel/${f}`, "utf-8"));
    const code = data.code;
    const box = prefBox.get(code.slice(0, 2));
    for (const [, t] of Object.entries(data.t)) {
      towns++;
      let dy = 0,
        dx = 0,
        acc = 0;
      for (let i = 0; i < t.a.length; i++) {
        parcels++;
        acc += t.a[i];
        dy += t.y[i];
        dx += t.x[i];
        const lat = t.o[0] + dy / SCALE;
        const lng = t.o[1] + dx / SCALE;
        scaleCount[t.s?.[i] ?? 0] = (scaleCount[t.s?.[i] ?? 0] ?? 0) + 1;
        if (!inJapan(lat, lng)) {
          if (outJapan.length < 10)
            outJapan.push(
              `${code} 地番${acc} (${lat.toFixed(6)},${lng.toFixed(6)})`,
            );
          continue;
        }
        if (
          box &&
          (lat < box.minLat ||
            lat > box.maxLat ||
            lng < box.minLng ||
            lng > box.maxLng)
        )
          outPref++;
        const m = dist(lat, lng, t.o[0], t.o[1]);
        if (m > maxFar) {
          maxFar = m;
          maxFarWhat = `${code} 地番${acc}`;
        }
        if (m > 5000) farFromTown++;
        hist[Math.min(Math.floor(m / BUCKET), BUCKETS)]++;
      }
    }
  }

  if (parcels) {
    const quantile = (q) => {
      let target = parcels * q,
        acc2 = 0;
      for (let i = 0; i <= BUCKETS; i++) {
        acc2 += hist[i];
        if (acc2 >= target) return i * BUCKET;
      }
      return BUCKETS * BUCKET;
    };
    const surveyed = Object.entries(scaleCount)
      .filter(([k]) => Number(k) > 0 && Number(k) <= 500)
      .reduce((s, [, v]) => s + v, 0);
    metrics.parcel = {
      towns,
      parcels,
      outPref,
      farFromTown,
      maxDistFromTown: Math.round(maxFar),
      medianDistFromTown: quantile(0.5),
      p99DistFromTown: quantile(0.99),
      surveyedRate: +((surveyed / parcels) * 100).toFixed(2),
    };
    console.log(
      `\n地番: ${parcels.toLocaleString()} 筆 / 町字 ${towns.toLocaleString()} 件`,
    );
    console.log(`  都道府県 bbox 外: ${outPref} 件`);
    console.log(
      `  筆と町字原点の距離: 中央値 ${metrics.parcel.medianDistFromTown}m / p99 ${metrics.parcel.p99DistFromTown}m / 最大 ${maxFar.toFixed(0)}m (${maxFarWhat})`,
    );
    console.log(
      `  accuracy=surveyed の割合: ${metrics.parcel.surveyedRate}%（縮尺1/500以下。§12.2）`,
    );
    if (outJapan.length)
      fail(`地番の座標が日本の範囲外:\n    ${outJapan.join("\n    ")}`);
    else console.log("  ✔ 日本の範囲内");
  }
}

// ---------------------------------------------------------------- Pages の制限

{
  let files = 0,
    bytes = 0,
    maxBytes = 0,
    maxName = "";
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) await walk(p);
      else {
        const s = await stat(p);
        files++;
        bytes += s.size;
        if (s.size > maxBytes) {
          maxBytes = s.size;
          maxName = p;
        }
      }
    }
  }
  await walk("dist-data");
  metrics.files = { count: files, bytes, maxBytes };
  console.log(
    `\n配信物: ${files.toLocaleString()} ファイル / ${(bytes / 1048576).toFixed(1)} MB / 最大 ${(maxBytes / 1024).toFixed(0)} KB`,
  );
  if (files > LIMITS.maxFiles)
    fail(`ファイル数が Pages の上限を超過: ${files} > ${LIMITS.maxFiles}`);
  else if (maxBytes > LIMITS.maxFileBytes)
    fail(`1ファイルが Pages の上限を超過: ${maxName}`);
  else console.log("  ✔ Pages の制限内");
}

// ---------------------------------------------------------------- 前回との比較

{
  let prev = null;
  try {
    prev = JSON.parse(await readFile(METRICS, "utf-8"));
  } catch {
    /* 初回 */
  }

  if (!prev) {
    console.log(
      `\n前回のメトリクスがありません（初回）。基準として記録します。`,
    );
    console.log(
      `次回以降は、カバレッジの低下・件数の減少・外れ値の増加でビルドを止めます。`,
    );
  } else {
    console.log(`\n前回ビルド（${prev.generated}）との比較:`);
    const cmp = (label, now, before, dropPct, unit = "") => {
      const d = before ? ((now - before) / before) * 100 : 0;
      console.log(
        `  ${label} ${before.toLocaleString()}${unit} → ${now.toLocaleString()}${unit} (${d >= 0 ? "+" : ""}${d.toFixed(2)}%)`,
      );
      return d;
    };
    const covDrop = prev.towns.coverage - metrics.towns.coverage;
    console.log(
      `  町字の座標カバレッジ ${prev.towns.coverage}% → ${metrics.towns.coverage}% (${covDrop > 0 ? "-" : "+"}${Math.abs(covDrop).toFixed(2)}pt)`,
    );
    if (covDrop > LIMITS.coverageDrop)
      fail(
        `町字の座標カバレッジが ${covDrop.toFixed(2)}pt 低下（許容 ${LIMITS.coverageDrop}pt）`,
      );

    for (const [obj, key, label] of [
      [metrics.towns, "total", "町字の件数"],
      [metrics.rsdt, "blocks", "番の件数"],
      [metrics.rsdt, "rsdts", "号の件数"],
    ]) {
      const before =
        key in (prev.towns ?? {}) ? prev.towns[key] : prev.rsdt[key];
      const d = cmp(label, obj[key], before);
      if (d < -LIMITS.countDrop)
        fail(
          `${label}が ${Math.abs(d).toFixed(2)}% 減少（許容 ${LIMITS.countDrop}%）`,
        );
    }

    // 分布の中央値は、差分エンコードのスケール誤りに桁違いに敏感に反応する
    for (const key of ["medianDistFromBlock", "p99DistFromBlock"]) {
      const before = prev.rsdt?.[key];
      if (before === undefined) continue;
      const d = before ? ((metrics.rsdt[key] - before) / before) * 100 : 0;
      console.log(
        `  号と街区の距離(${key === "medianDistFromBlock" ? "中央値" : "p99"}) ${before}m → ${metrics.rsdt[key]}m (${d >= 0 ? "+" : ""}${d.toFixed(1)}%)`,
      );
      if (Math.abs(d) > LIMITS.medianShift) {
        fail(
          `号と街区の距離の分布が ${d.toFixed(1)}% 変化（許容 ±${LIMITS.medianShift}%）。差分エンコードの破損を疑う`,
        );
      }
    }

    if (prev.parcel && metrics.parcel) {
      for (const key of ["medianDistFromTown", "p99DistFromTown"]) {
        const before = prev.parcel[key];
        const d = before ? ((metrics.parcel[key] - before) / before) * 100 : 0;
        console.log(
          `  筆と町字の距離(${key.startsWith("median") ? "中央値" : "p99"}) ${before}m → ${metrics.parcel[key]}m (${d >= 0 ? "+" : ""}${d.toFixed(1)}%)`,
        );
        if (Math.abs(d) > LIMITS.medianShift) {
          fail(
            `筆と町字の距離の分布が ${d.toFixed(1)}% 変化。差分エンコードの破損を疑う`,
          );
        }
      }
      const d =
        ((metrics.parcel.parcels - prev.parcel.parcels) / prev.parcel.parcels) *
        100;
      console.log(
        `  地番の件数 ${prev.parcel.parcels.toLocaleString()} → ${metrics.parcel.parcels.toLocaleString()} (${d >= 0 ? "+" : ""}${d.toFixed(2)}%)`,
      );
      if (d < -LIMITS.countDrop)
        fail(`地番の件数が ${Math.abs(d).toFixed(2)}% 減少`);
    }

    // 外れ値は「増えたか」で見る。絶対値では離島と異常を区別できない
    for (const [obj, key, label] of [
      [
        metrics.towns,
        "farFromCity",
        `市区町村から${LIMITS.townFromCity / 1000}km超の町字`,
      ],
      [metrics.towns, "outPref", "都道府県 bbox 外の町字"],
      [metrics.rsdt, "farFromBlock", `街区から${LIMITS.rsdtFromBlock}m超の号`],
    ]) {
      const before =
        key in (prev.towns ?? {}) ? prev.towns[key] : prev.rsdt[key];
      const d = before
        ? ((obj[key] - before) / before) * 100
        : obj[key] > 0
          ? 100
          : 0;
      console.log(
        `  ${label} ${before} → ${obj[key]} (${d >= 0 ? "+" : ""}${d.toFixed(1)}%)`,
      );
      if (d > LIMITS.outlierGrowth) {
        fail(
          `${label}が ${d.toFixed(1)}% 増加（許容 ${LIMITS.outlierGrowth}%）。新たな座標の壊れを疑う`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------- 結果

console.log("");
for (const n of notes) console.log(`  ℹ ${n}`);
for (const f of failures) console.log(`✖ 失敗: ${f}`);

if (failures.length) {
  console.log(`\n検証ゲート: ${failures.length}件の失敗。ビルドを中止します。`);
  process.exit(1);
}
if (WRITE) {
  metrics.generated = new Date().toISOString().slice(0, 10);
  await writeFile(METRICS, JSON.stringify(metrics, null, 1));
  console.log(`\n${METRICS} を更新しました。`);
}
console.log(`検証ゲート: 通過`);
