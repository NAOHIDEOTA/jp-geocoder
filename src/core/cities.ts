/**
 * 市区町村インデックス。DOC.md §4.2 / §6.1
 * cities.json は唯一メモリ常駐する索引（約1,965件）。キーは配信物に焼き込み済み。
 */

import type { DictEntry } from "./consume.js";

export type CityLevel = "pref" | "city" | "ward" | "special_ward";

/** cities.json の1エントリ。フィールド名は配信サイズを抑えるため短くしてある */
export interface CityRecord {
  /** ABR の lg_code（検査数字つき6桁）。都道府県は2桁 */
  code: string;
  /** 都道府県コード2桁 */
  pref: string;
  /** 表示用の名称。行政区は「さいたま市浦和区」のように市名を含む */
  name: string;
  level: CityLevel;
  /** 正規化済みの漢字キー（別名を含む） */
  k: string[];
  /** 正規化済みのカナキー（別名を含む） */
  kk: string[];
  /** 郡名（あれば） */
  county?: string;
  /** 行政区の場合の政令市本体の lg_code */
  parent?: string | null;
  lat?: number;
  lng?: number;
  /** 町字数。DOC.md §7 の tie-break に使う規模の代理指標（人口の代用） */
  towns?: number;
}

export interface CitiesFile {
  generated: string;
  source: string;
  cities: CityRecord[];
}

/** cities.json を consumeLongest に渡せる DictEntry の形に包む */
export class CityIndex {
  readonly records: readonly CityRecord[];
  private readonly entries: DictEntry<CityRecord>[] = [];
  private readonly index = new Map<string, CityRecord>();

  constructor(file: CitiesFile) {
    this.records = file.cities;
    for (const c of file.cities) this.index.set(c.code, c);
    for (const c of file.cities) {
      if (c.level === "pref") continue; // 都道府県は pref.ts が担当する
      // 漢字とカナは同じエントリに持たせる。別エントリ（key:""）だと
      // consumeAll が key しか見ず、cities.json の23.7%が死にデータになる
      const kana = c.kk?.[0];
      for (const key of c.k) {
        this.entries.push(kana ? { key, kana, value: c } : { key, value: c });
      }
      for (const extra of (c.kk ?? []).slice(1)) {
        this.entries.push({ key: "", kana: extra, value: c });
      }
    }
  }

  /** 都道府県で絞った候補（未指定なら全件） */
  candidates(prefCode?: string): DictEntry<CityRecord>[] {
    if (!prefCode) return this.entries;
    return this.entries.filter((e) => e.value.pref === prefCode);
  }

  /** 都道府県レコード（座標を返すために使う）。都道府県はコード2桁 */
  pref(code: string): CityRecord | undefined {
    const c = this.index.get(code);
    return c?.level === "pref" ? c : undefined;
  }

  byCode(code: string): CityRecord | undefined {
    return this.index.get(code);
  }
}
