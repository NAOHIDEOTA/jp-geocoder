/**
 * 編集距離によるタイポ許容。DOC.md §6.2 / §6.3
 *
 * 対象は常に小さい集合（市区町村 約1,900 / シャード内の町字 約2,000）なので総当たりで足りる。
 *
 * 素朴なレーベンシュタインは住居表示で事故る（「1丁目」と「2丁目」が距離1）。§6.3 の規則:
 *   1. 数字は完全一致のみ。数字列が違えば距離計算に入る前に弾く
 *   2. 異体字・ヶケ・之ノは距離ではなく正規化で潰す（normalize.ts）
 *   3. 3文字以下（南・緑・本町）は完全一致のみ
 */

/** 数字列を順序ごと取り出す。これが違えばタイポとみなさない */
function digitRuns(s: string): string {
  return (s.match(/[0-9]+/gu) ?? []).join(",");
}

/** 短い地名は1文字違うと別の地名になるので距離を許さない。§6.3 */
export function allowedDistance(len: number): number {
  return len <= 3 ? 0 : 1;
}

/**
 * 上限つきレーベンシュタイン距離。
 * `max` を超えると分かった時点で打ち切り、`max + 1` を返す。
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (max <= 0) return 1;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    // その行で調べる必要のある範囲だけを見る
    const from = Math.max(1, i - max);
    const to = Math.min(n, i + max);
    if (from > 1) cur[from - 1] = max + 1;
    let best = max + 1;
    for (let j = from; j <= to; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(
        (prev[j] ?? max + 1) + 1,
        (cur[j - 1] ?? max + 1) + 1,
        (prev[j - 1] ?? max + 1) + cost,
      );
      cur[j] = v;
      if (v < best) best = v;
    }
    if (to < n) cur[to + 1] = max + 1;
    if (best > max) return max + 1;
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return (prev[n] as number) <= max ? (prev[n] as number) : max + 1;
}

/** タイポとして許容できるか。許容外なら null */
export function typoDistance(input: string, candidate: string): number | null {
  // 数字は完全一致のみ。「1丁目」と「2丁目」を距離1にしない
  if (digitRuns(input) !== digitRuns(candidate)) return null;

  const max = allowedDistance(candidate.length);
  if (max === 0) return input === candidate ? 0 : null;

  const d = boundedLevenshtein(input, candidate, max);
  return d <= max ? d : null;
}

export interface FuzzyMatch<T> {
  value: T;
  key: string;
  distance: number;
  /** 入力から一致部分を取り除いた残り */
  rest: string;
}

/**
 * 入力の先頭にタイポ込みで一致する候補を探す。
 * 挿入・削除を許すため、候補キーの長さ ±max の接頭辞を試す。
 */
export function fuzzyPrefix<T>(
  input: string,
  entries: Iterable<{ key: string; value: T }>,
  limit = 5,
): FuzzyMatch<T>[] {
  const out: FuzzyMatch<T>[] = [];

  for (const e of entries) {
    const k = e.key;
    if (!k) continue;
    const max = allowedDistance(k.length);
    if (max === 0) continue; // 短いキーは完全一致のみ。前方一致側で拾われる

    // 完全一致するものは前方一致側の仕事。
    // 拾うと「世田谷区太子堂」で "世田谷"(距離1) を選んでしまう
    if (input.startsWith(k)) continue;

    // 距離が同じなら入力を多く消費した方を採る。
    // 「さいたま市浦和く…」は7文字でも8文字でも距離1になるが、
    // 7文字だと残りが「く高砂3-15-1」になり後段の町字解決が壊れる
    let best: { d: number; used: number } | null = null;
    for (let used = k.length - max; used <= k.length + max; used++) {
      if (used <= 0 || used > input.length) continue;
      const d = typoDistance(input.slice(0, used), k);
      if (d === null || d === 0) continue;
      if (best === null || d < best.d || (d === best.d && used > best.used)) {
        best = { d, used };
      }
    }
    if (best) {
      out.push({ value: e.value, key: k, distance: best.d, rest: input.slice(best.used) });
    }
  }

  // 距離が小さく、長く消費できたものを優先する
  return out
    .sort((a, b) => a.distance - b.distance || b.key.length - a.key.length)
    .slice(0, limit);
}
