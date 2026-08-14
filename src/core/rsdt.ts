/**
 * 住居表示（番・号）の解決。DOC.md §4.4 / §8.4
 *
 * 配信物 rsdt/{lg_code}.json:
 *   { code, t: { <machiaza_id>: { <番>: { p:[lat,lng], r:{ <号>: [dLat,dLng] } } } } }
 *
 * 号は街区からの差分（1e-6度の整数）。全国2,200万点あり絶対値だと倍以上になる。
 */

import type { Fetcher } from "../types.js";
import type { BanchiToken } from "./banchi.js";

export interface BlockRecord {
  /** 街区（番）の代表点 */
  p: [number, number];
  /**
   * 号が 1..N の連番のときの差分配列（実測で73%の街区がこれ）。
   * キーを持たないぶん配信物が15%小さくなる。q[i] が (i+1)号。
   */
  q?: [number, number][];
  /** 飛び番・枝番のときのキー付きの差分（1e-6度単位） */
  r?: Record<string, [number, number]>;
}

export interface RsdtFile {
  code: string;
  t: Record<string, Record<string, BlockRecord>>;
}

export interface RsdtHit {
  lat: number;
  lng: number;
  /** 号まで解決できたか。false なら番どまり */
  isRsdt: boolean;
  block: number;
  rsdt?: number;
  /** 枝番つき（32-1 など）で当たった場合の表示用キー */
  rsdtKey?: string;
}

/**
 * 住居表示のトークンを 番 / 号 に割り当てる。町字が解決済みである前提。
 * 明示された単位（「2番3号」）を優先し、無ければ順に詰める。
 */
export function assignBanGo(tokens: readonly BanchiToken[]): {
  block?: number;
  rsdt?: number;
} {
  const explicitBan = tokens.find((t) => t.unit === "ban");
  const explicitGo = tokens.find((t) => t.unit === "go");
  if (explicitBan || explicitGo) {
    const out: { block?: number; rsdt?: number } = {};
    if (explicitBan) out.block = explicitBan.value;
    if (explicitGo) out.rsdt = explicitGo.value;
    return out;
  }

  // 単位が無いものだけを順に使う。丁目は町字側で消費済み
  const plain = tokens.filter((t) => t.unit === undefined || t.unit === "chome");
  const rest = plain.filter((t) => t.unit !== "chome");
  const out: { block?: number; rsdt?: number } = {};
  if (rest[0]) out.block = rest[0].value;
  if (rest[1]) out.rsdt = rest[1].value;
  return out;
}

/** machiaza_id がどのパートにあるかを境界表から決める */
function partName(code: string, bounds: readonly string[], machiazaId: string): string {
  if (!bounds.length) return `rsdt/${code}.json`;
  let part = 0;
  for (let i = 0; i < bounds.length; i++) {
    if ((bounds[i] as string) <= machiazaId) part = i + 1;
  }
  return `rsdt/${code}_${part}.json`;
}

/**
 * 番・号の座標を引く。
 *
 * 号が見つからなければ番の代表点へ、番も無ければ null を返す。
 * 呼び出し側は null のとき町字の代表点にフォールバックする（§8.4）。
 */
export async function lookupRsdt(
  fetcher: Fetcher,
  code: string,
  bounds: readonly string[],
  machiazaId: string,
  block: number | undefined,
  rsdt: number | undefined
): Promise<RsdtHit | null> {
  if (block === undefined) return null;

  let file: RsdtFile;
  try {
    file = (await fetcher.get(partName(code, bounds, machiazaId))) as RsdtFile;
  } catch {
    return null;
  }

  const blocks = file.t?.[machiazaId];
  const blk = blocks?.[String(block)];
  if (!blk) return null;

  // 連番の街区は配列から直接引く
  if (rsdt !== undefined && blk.q) {
    const d = blk.q[rsdt - 1];
    if (d) {
      return {
        lat: Number((blk.p[0] + d[0] / 1e6).toFixed(6)),
        lng: Number((blk.p[1] + d[1] / 1e6).toFixed(6)),
        isRsdt: true,
        block,
        rsdt,
      };
    }
  }

  if (rsdt !== undefined && blk.r) {
    const exact = blk.r[String(rsdt)];
    if (exact) {
      return {
        lat: Number((blk.p[0] + exact[0] / 1e6).toFixed(6)),
        lng: Number((blk.p[1] + exact[1] / 1e6).toFixed(6)),
        isRsdt: true,
        block,
        rsdt,
      };
    }
    // 枝番つき（「32-1」）しか無いことがある。先頭が一致する最小の枝番を採る
    const branch = Object.keys(blk.r)
      .filter((k) => k.startsWith(`${rsdt}-`))
      .sort()[0];
    if (branch) {
      const d = blk.r[branch] as [number, number];
      return {
        lat: Number((blk.p[0] + d[0] / 1e6).toFixed(6)),
        lng: Number((blk.p[1] + d[1] / 1e6).toFixed(6)),
        isRsdt: true,
        block,
        rsdt,
        rsdtKey: branch,
      };
    }
  }

  // 号まで解決できない場合は番の代表点（§8.4）
  return { lat: blk.p[0], lng: blk.p[1], isRsdt: false, block };
}
