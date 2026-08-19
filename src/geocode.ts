/**
 * 解決パイプライン。DOC.md §6.1
 *
 * 都道府県 → 市区町村 → 町字 → 番 → 号 の順に前方一致で削り取る。
 * データに触るのは fetcher 経由のみ（§3.3）。
 *
 * 町字の転置インデックスが座標・住居表示フラグ・表示名まで持つので候補の列挙は
 * 1 fetch で終わる。号まで降りるのは上位候補だけ（候補ごとに引くと実測28回になった）。
 */

import { consumeAll } from "./core/consume.js";
import { fuzzyPrefix } from "./core/distance.js";
import { toKey, toExactKey } from "./core/normalize.js";
import { consumePref, resolvePref } from "./core/pref.js";
import { CityIndex, type CitiesFile, type CityRecord } from "./core/cities.js";
import {
  buildMunicipalities,
  buildPrefectures,
} from "./core/municipalities.js";
import { RailIndex, type RailFile } from "./core/rail.js";
import { parseTail } from "./core/banchi.js";
import {
  lookupTown,
  isResidential,
  townChome,
  townCode,
  townId,
  townKoaza,
  townLat,
  townLng,
  townName,
  townOaza,
  type ShardsFile,
  type TownEntry,
  type TownHit,
} from "./core/towns.js";
import { assignBanGo, lookupRsdt, type RsdtHit } from "./core/rsdt.js";
import { assignParcel, lookupParcel, type ParcelHit } from "./core/parcel.js";
import { createHttpFetcher } from "./fetcher/httpFetcher.js";
import type {
  Candidate,
  Fetcher,
  Geocoder,
  GeocoderOptions,
  GeocodeResult,
  MunicipalitiesResult,
  MunicipalityOptions,
  PrefecturesResult,
  LinesResult,
  NearbyStationsResult,
  NearestStationsOptions,
  StationQuery,
  StationsResult,
} from "./types.js";

/**
 * 出典表示。実際に配信物へ取り込んだものだけを挙げる。
 * CODH は CC BY 4.0 で doi を含む指定の形が必須。
 */
export const ATTRIBUTION: readonly string[] = [
  "デジタル庁 アドレス・ベース・レジストリ",
  "国土交通省 位置参照情報",
  "『歴史的行政区域データセットβ版』（CODH作成）doi:10.20676/00000447",
];

/**
 * 既定の配信元。利用者に URL を覚えさせないための値。
 * 配信先を変えるときはここ1行を直す（利用者側の指定は不要）。
 */
export const DEFAULT_BASE_URL = "https://jp-geocoder.pages.dev/v1";

/**
 * 市区町村一覧の出典。cities.json は ABR だけから作られるので、
 * 位置参照情報・CODH は挙げない（使っていないものを出典に書かない）。
 */
export const CITY_ATTRIBUTION: readonly string[] = [
  "デジタル庁 アドレス・ベース・レジストリ",
];

/**
 * 駅・路線の出典。駅データ.jp は表示義務が無い（利用規約）が、
 * 出所を隠さない方針なので明示する。
 */
export const RAIL_ATTRIBUTION: readonly string[] = ["駅データ.jp"];

/** 号まで降りる候補の数。§1.2 の fetch 回数を守るための上限 */
const DESCEND_LIMIT = 2;

/** 候補の並べ替えに使う解決の深さ。同名町字が複数あるとき最も強い手がかり（§7.1） */
const DEPTH: Record<string, number> = {
  rsdt: 5,
  block: 4,
  parcel: 4,
  oaza: 3,
  city: 2,
  pref: 1,
};

function byDepth(a: Candidate, b: Candidate): number {
  return (
    (DEPTH[b.matchLevel] ?? 0) - (DEPTH[a.matchLevel] ?? 0) || b.score - a.score
  );
}

function prefCandidate(pref: CityRecord): Candidate {
  return {
    address: pref.name,
    lat: pref.lat ?? 0,
    lng: pref.lng ?? 0,
    matchLevel: "pref",
    system: "residential",
    accuracy: "representative",
    score: 1,
    components: { pref: pref.name },
  };
}

function cityCandidate(
  city: CityRecord,
  prefName: string | undefined,
  score: number,
  building: string | undefined,
): Candidate {
  return {
    address: `${prefName ?? ""}${city.name}`,
    lat: city.lat ?? 0,
    lng: city.lng ?? 0,
    matchLevel: "city",
    system: "residential",
    accuracy: "representative",
    score,
    ...(building ? { building } : {}),
    components: {
      ...(prefName ? { pref: prefName } : {}),
      city: city.name,
      ...(city.county ? { county: city.county } : {}),
    },
  };
}

/**
 * 町字（＋番・号）の候補を作る。フォールバック規約は §8.4。
 *   号 → rsdt/surveyed、番 → block/representative、町字 → oaza/representative
 */
function townCandidate(
  city: CityRecord | undefined,
  entry: TownEntry,
  prefName: string | undefined,
  score: number,
  building: string | undefined,
  hit: RsdtHit | null,
  parcel: ParcelHit | null,
): Candidate {
  const cityName = city?.name ?? "";
  const suffix = parcel
    ? parcel.parcel.filter((n) => n).join("-") + "番地"
    : hit
      ? hit.isRsdt
        ? `${hit.block}番${hit.rsdtKey ?? hit.rsdt}号`
        : `${hit.block}番`
      : "";

  const matchLevel = parcel
    ? "parcel"
    : hit
      ? hit.isRsdt
        ? "rsdt"
        : "block"
      : "oaza";

  return {
    address: `${prefName ?? ""}${cityName}${townName(entry)}${suffix}`,
    lat: parcel?.lat ?? hit?.lat ?? townLat(entry) ?? city?.lat ?? 0,
    lng: parcel?.lng ?? hit?.lng ?? townLng(entry) ?? city?.lng ?? 0,
    matchLevel,
    // 住居表示実施フラグが唯一の判定材料（§4.4）
    system: isResidential(entry) ? "residential" : "parcel",
    // 号は実測点。筆は縮尺から判定（§12.2）。番・町字は代表点（§8.3）
    accuracy: parcel
      ? parcel.accuracy
      : hit?.isRsdt
        ? "surveyed"
        : "representative",
    score,
    ...(building ? { building } : {}),
    machiazaId: townId(entry),
    // すべて分割・半角数字で返す。表示用の結合文字列は address が担う
    components: {
      ...(prefName ? { pref: prefName } : {}),
      ...(cityName ? { city: cityName } : {}),
      ...(city?.county ? { county: city.county } : {}),
      oaza: townOaza(entry),
      ...(townChome(entry) ? { chome: townChome(entry) } : {}),
      ...(townKoaza(entry) ? { koaza: townKoaza(entry) } : {}),
      ...(hit ? { block: hit.block } : {}),
      ...(hit?.isRsdt && hit.rsdt !== undefined ? { rsdt: hit.rsdt } : {}),
      ...(parcel ? { parcel: parcel.parcel.filter((n) => n) } : {}),
    },
  };
}

/** 町字の残り文字列から建物名だけを取り出す（fetch なし） */
function buildingOf(rest: string): string | undefined {
  return parseTail(rest.replace(/^[-ー―‐−–—の]/u, "")).building;
}

/** 町字の解決後、住居表示の番・号まで降りる。未実施の町字では何もしない */
async function descend(
  fetcher: Fetcher,
  shards: ShardsFile,
  entry: TownEntry,
  rest: string,
): Promise<{
  hit: RsdtHit | null;
  parcel: ParcelHit | null;
  building: string | undefined;
}> {
  // 先頭の区切り記号を落とす。町字が「太子堂5」で当たると残りが「-5-5」になる
  const tail = parseTail(rest.replace(/^[-ー―‐−–—の]/u, ""));
  const building = tail.building;
  const code = townCode(entry);
  const none = { hit: null, parcel: null, building };

  // 住居表示実施フラグが分岐の唯一の手がかり（§4.4）。入力からは判別できない
  if (isResidential(entry)) {
    if (!shards.rsdt) return none;
    const { block, rsdt } = assignBanGo(tail.tokens);
    const hit = await lookupRsdt(
      fetcher,
      code,
      shards.rsdt[code] ?? [],
      townId(entry),
      block,
      rsdt,
    );
    return { hit, parcel: null, building };
  }

  if (!shards.parcel) return none;
  const nums = assignParcel(tail.tokens);
  if (!nums) return none;
  const parcel = await lookupParcel(
    fetcher,
    code,
    shards.parcel[code] ?? [],
    townId(entry),
    nums,
  );
  return { hit: null, parcel, building };
}

/** 一致軸のスコア（§7）。漢字 1.00 / カナ 0.90 / 編集距離1 0.60 */
const axisScore = (hit: TownHit): number =>
  hit.axis === "exact" ? 1.0 : hit.axis === "kana" ? 0.9 : 0.6;

/** 市区町村がタイポで一致したときのスコア */
const CITY_TYPO_SCORE = 0.6;

/** 旧自治体名の一致。表記は正しいが現在の名称ではないので完全一致より下げる */
const ALIAS_SCORE = 0.85;

/** alias.json: 正規化キー → 現在の市区町村コード群（§12.3） */
type AliasFile = Record<string, string[]>;

/**
 * 旧自治体名で前方一致する候補を返す（「浦和市高砂3-15-1」→ さいたま市浦和区）。
 * 値は市区町村コード。住所文字列をキーにしない（§12.3）。
 */
function aliasHits(
  alias: AliasFile,
  index: CityIndex,
  key: string,
): { record: CityRecord; rest: string }[] {
  const out: { record: CityRecord; rest: string }[] = [];
  let best = "";
  for (const k of Object.keys(alias)) {
    if (k && key.startsWith(k) && k.length > best.length) best = k;
  }
  if (!best) return out;
  for (const code of alias[best] ?? []) {
    const rec = index.byCode(code);
    if (rec) out.push({ record: rec, rest: key.slice(best.length) });
  }
  return out;
}

export function createGeocoder(options: GeocoderOptions = {}): Geocoder {
  const fetcher: Fetcher =
    options.fetcher ?? createHttpFetcher(options.baseUrl ?? DEFAULT_BASE_URL);
  const limit = options.limit ?? 5;

  let indexPromise: Promise<CityIndex> | null = null;
  const loadIndex = (): Promise<CityIndex> => {
    if (!indexPromise) {
      indexPromise = fetcher
        .get("cities.json")
        .then((file) => new CityIndex(file as CitiesFile));
    }
    return indexPromise;
  };

  let aliasPromise: Promise<AliasFile | null> | null = null;
  const loadAlias = (): Promise<AliasFile | null> => {
    if (!aliasPromise) {
      // alias.json が無い配信でも動くようにする
      aliasPromise = fetcher.get("alias.json").then(
        (f) => f as AliasFile,
        () => null,
      );
    }
    return aliasPromise;
  };

  let shardsPromise: Promise<ShardsFile | null> | null = null;
  const loadShards = (): Promise<ShardsFile | null> => {
    if (!shardsPromise) {
      // shards.json が無い配信でも市区町村までは動くようにする
      shardsPromise = fetcher.get("shards.json").then(
        (f) => f as ShardsFile,
        () => null,
      );
    }
    return shardsPromise;
  };

  let railPromise: Promise<RailIndex> | null = null;
  const loadRail = (): Promise<RailIndex> => {
    if (!railPromise) {
      railPromise = fetcher
        .get("rail.json")
        .then((file) => new RailIndex(file as RailFile));
    }
    return railPromise;
  };

  /**
   * 町字レベルの候補を作り、上位だけ番・号へ降ろす。
   * @param allowed 市区町村が特定できている場合のコード集合。null なら全国
   */
  async function resolveTowns(
    shards: ShardsFile,
    index: CityIndex,
    rest: string,
    prefName: string | undefined,
    allowed: Set<string> | null,
    prefCode: string | undefined,
    outerScore = 1,
    /** 送り字を統一していない残り。rest からは復元できない。カナ軸では undefined */
    exactRest?: string,
  ): Promise<Candidate[]> {
    const hits = await lookupTown(fetcher, shards, rest);
    if (!hits.length) return [];

    // 最長が常に正解とは限らない（他市の丁目省略別名が長く当たる）ので、
    // 条件を満たすエントリが残る最初のものを採る
    let chosen: { hit: TownHit; entries: TownEntry[] } | null = null;
    for (const hit of hits) {
      let entries = hit.entries;
      if (allowed) entries = entries.filter((e) => allowed.has(townCode(e)));
      else if (prefCode) {
        entries = entries.filter((e) => townCode(e).startsWith(prefCode));
      }
      if (entries.length) {
        chosen = { hit, entries };
        break;
      }
    }
    if (!chosen) return [];

    // 送り字の統一で別の町字が同じキーに落ちている場合、入力どおりの表記に絞る。
    // 該当が1つも無ければ絞らない（表記ゆれ入力なので全部返す）
    let entries = chosen.entries;
    if (entries.length > 1 && exactRest) {
      const exactly = entries.filter((e) =>
        exactRest.startsWith(toExactKey(townName(e))),
      );
      if (exactly.length) entries = exactly;
    }

    // ここで確定。追加の fetch は無い。階層ごとのスコアを掛ける（§7）
    const score = Number((axisScore(chosen.hit) * outerScore).toFixed(3));
    const ranked = [...entries].sort((a, b) => {
      const ca = index.byCode(townCode(a))?.towns ?? 0;
      const cb = index.byCode(townCode(b))?.towns ?? 0;
      return cb - ca;
    });

    const out: Candidate[] = [];
    const max = Math.max(limit, 5);
    for (let i = 0; i < ranked.length && out.length < max; i++) {
      const entry = ranked[i] as TownEntry;
      const city = index.byCode(townCode(entry));
      // 入力で県が省略されていても、解決した市区町村から一意に定まるので補完する
      const pn = prefName ?? index.pref(townCode(entry).slice(0, 2))?.name;
      // 上位だけ号まで降りる。§1.2 の fetch 回数を守るため
      const { hit, parcel, building } =
        i < DESCEND_LIMIT
          ? await descend(fetcher, shards, entry, chosen.hit.rest)
          : { hit: null, parcel: null, building: buildingOf(chosen.hit.rest) };
      out.push(townCandidate(city, entry, pn, score, building, hit, parcel));
    }
    return out;
  }

  return {
    async geocode(address: string): Promise<GeocodeResult> {
      const index = await loadIndex();
      const attribution = [...ATTRIBUTION];

      // 1. 都道府県を削り取る。省略は正常なので null でも続行する（§6.1）
      const pref = consumePref(address);
      const prefRecord = pref ? index.pref(pref.code) : undefined;
      const prefName = prefRecord?.name ?? pref?.name;
      const rest = pref ? pref.rest : address;

      // 送り字を統一していないキー。toKey と長さが一致する（置換のみ）ので、
      // 残り文字数で末尾から切り出せば対応が取れる
      const exactWhole = toExactKey(address);
      const exactOf = (tail: string): string | undefined =>
        tail.length && exactWhole.length === toKey(address).length
          ? exactWhole.slice(exactWhole.length - tail.length)
          : undefined;

      // 2. 市区町村を前方一致で拾う。1件に絞らず候補を残す（§6.4）
      const cityHits = consumeAll(rest, index.candidates(pref?.code));
      let cityScore = 1;

      /**
       * タイポ補正（§6.2 / §6.4）。完全一致があっても併せて出す。
       * 「さいたま市浦和く…」は「さいたま市」が完全一致するため、
       * 完全一致が無いときだけ回すと区名のタイポを拾えない。
       * どちらが正しいかは解決の深さで決める（§7.1）。
       */
      // 旧自治体名（§12.3）。完全一致が取れなかったときだけ引く
      if (!cityHits.length) {
        const alias = await loadAlias();
        if (alias) {
          for (const h of aliasHits(alias, index, toKey(rest))) {
            cityHits.push({
              value: h.record,
              kind: "exact" as const,
              score: ALIAS_SCORE,
              matched: 0,
              rest: h.rest,
            });
          }
          if (cityHits.length) cityScore = ALIAS_SCORE;
        }
      }

      const fuzzy = fuzzyPrefix(
        toKey(rest),
        index.candidates(pref?.code).map((e) => ({ key: e.key, value: e.value })),
        8,
      );
      if (fuzzy.length) {
        const seen = new Set(cityHits.map((h) => h.value.code));
        for (const m of fuzzy) {
          if (seen.has(m.value.code)) continue;
          seen.add(m.value.code);
          cityHits.push({
            value: m.value,
            kind: "exact" as const,
            score: CITY_TYPO_SCORE,
            matched: m.key.length,
            rest: m.rest,
          });
        }
        if (!cityHits.length) cityScore = CITY_TYPO_SCORE;
      }
      const shards = await loadShards();

      // 3. 町字を解決する（§6.1 手順2〜4）
      if (shards) {
        if (cityHits.length) {
          // 市区町村ごとに残り文字列が違うのでまとめて引く
          const byRest = new Map<string, typeof cityHits>();
          for (const h of cityHits) {
            const list = byRest.get(h.rest) ?? [];
            list.push(h);
            byRest.set(h.rest, list);
          }
          const all: Candidate[] = [];
          for (const [tail, hits] of byRest) {
            if (!tail) continue;
            const allowed = new Set(hits.map((h) => h.value.code));
            // その残り文字列に紐づく市区町村候補のスコア（タイポなら 0.6）
            cityScore = Math.max(...hits.map((h) => h.score));
            all.push(
              ...(await resolveTowns(
                shards,
                index,
                tail,
                prefName,
                allowed,
                pref?.code,
                cityScore,
                exactOf(tail),
              )),
            );
          }
          if (all.length) {
            return {
              candidates: all.sort(byDepth).slice(0, limit),
              attribution,
            };
          }
        } else {
          // 市区町村が省略された「太子堂1-1-1」は転置から入る（§6.1）
          const direct = await resolveTowns(
            shards,
            index,
            rest,
            prefName,
            null,
            pref?.code,
            1,
            exactOf(rest),
          );
          if (direct.length) {
            return {
              candidates: direct.sort(byDepth).slice(0, limit),
              attribution,
            };
          }
        }
      }

      // 4. 町字まで解けなければ市区町村で返す
      if (!cityHits.length) {
        return {
          candidates: prefRecord ? [prefCandidate(prefRecord)] : [],
          attribution,
        };
      }

      const scored: { candidate: Candidate; record: CityRecord }[] = [];
      const seen = new Set<string>();
      for (const h of cityHits) {
        if (seen.has(h.value.code)) continue;
        seen.add(h.value.code);
        const tail = parseTail(h.rest);
        scored.push({
          candidate: cityCandidate(
            h.value,
            prefName ?? index.pref(h.value.pref)?.name,
            h.score,
            tail.building,
          ),
          record: h.value,
        });
      }
      scored.sort(
        (a, b) =>
          b.candidate.score - a.candidate.score ||
          (b.record.towns ?? 0) - (a.record.towns ?? 0),
      );

      return {
        candidates: scored.slice(0, limit).map((s) => s.candidate),
        attribution,
      };
    },

    async listPrefectures(): Promise<PrefecturesResult> {
      const index = await loadIndex();
      return {
        prefectures: buildPrefectures(index.records),
        attribution: [...CITY_ATTRIBUTION],
      };
    },

    async listMunicipalities(
      pref: string | number,
      options: MunicipalityOptions = {},
    ): Promise<MunicipalitiesResult> {
      const attribution = [...CITY_ATTRIBUTION];
      const resolved = resolvePref(pref);
      // 該当しない都道府県は空配列を返す（例外にしない）
      if (!resolved) return { municipalities: [], attribution };

      const index = await loadIndex();
      return {
        municipalities: buildMunicipalities(
          index.records,
          resolved.code,
          options.designatedCity ?? "wards",
        ),
        attribution,
      };
    },

    async listStations(query: StationQuery = {}): Promise<StationsResult> {
      const attribution = [...RAIL_ATTRIBUTION];
      // 都道府県が指定されていて解決できないなら、全件を返さず空で返す
      let prefCode: number | null = null;
      if (query.pref !== undefined && query.pref !== null) {
        const resolved = resolvePref(query.pref);
        if (!resolved) return { stations: [], attribution };
        prefCode = Number(resolved.code);
      }

      const rail = await loadRail();
      let stations = rail.stations as readonly (typeof rail.stations)[number][];
      if (prefCode !== null) stations = stations.filter((s) => s.pref === prefCode);
      if (query.line !== undefined)
        stations = stations.filter((s) => s.lineCode === query.line);
      return { stations: [...stations], attribution };
    },

    async getStation(code: number): Promise<StationsResult> {
      const attribution = [...RAIL_ATTRIBUTION];
      const rail = await loadRail();
      const hit = rail.station(code);
      return { stations: hit ? [hit] : [], attribution };
    },

    async listLines(pref: string | number): Promise<LinesResult> {
      const attribution = [...RAIL_ATTRIBUTION];
      const resolved = resolvePref(pref);
      if (!resolved) return { lines: [], attribution };

      const rail = await loadRail();
      const prefCode = Number(resolved.code);
      // その県に駅がある路線だけを、路線コード順で返す
      const codes = new Set<number>();
      for (const s of rail.stations) {
        if (s.pref === prefCode) codes.add(s.lineCode);
      }
      return {
        lines: rail.lines.filter((l) => codes.has(l.code)),
        attribution,
      };
    },

    async nearestStations(
      lat: number,
      lng: number,
      options: NearestStationsOptions = {},
    ): Promise<NearbyStationsResult> {
      const attribution = [...RAIL_ATTRIBUTION];
      if (!Number.isFinite(lat) || !Number.isFinite(lng))
        return { stations: [], attribution };

      const rail = await loadRail();
      const limit = options.limit ?? 10;
      let hits = rail.nearest(lat, lng, limit, options.groupByStation ?? false);
      if (options.maxDistance !== undefined)
        hits = hits.filter((h) => h.distance <= options.maxDistance!);
      return { stations: hits, attribution };
    },

    async nearestStationsByAddress(
      address: string,
      options: NearestStationsOptions = {},
    ) {
      const geocoded = await this.geocode(address);
      const candidate = geocoded.candidates[0] ?? null;
      if (!candidate) {
        return {
          stations: [],
          candidate: null,
          // 住所が解けなくても、何を使おうとしたかは示す
          attribution: [...geocoded.attribution, ...RAIL_ATTRIBUTION],
        };
      }
      const near = await this.nearestStations(
        candidate.lat,
        candidate.lng,
        options,
      );
      return {
        stations: near.stations,
        candidate,
        attribution: [...geocoded.attribution, ...RAIL_ATTRIBUTION],
      };
    },
  };
}
