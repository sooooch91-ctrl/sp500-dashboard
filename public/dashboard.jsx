import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Radar, Cell, LabelList,
} from "recharts";
import {
  RefreshCw, Search, X, Info, ArrowUpDown, TrendingUp, TrendingDown,
  AlertTriangle, Download,
} from "lucide-react";

/* ============================================================
   팔레트 / 폰트
   ============================================================ */
const C = {
  bg: "#0B1220",
  panel: "#121B2E",
  panelAlt: "#182338",
  border: "#25334F",
  borderLight: "#31415E",
  text: "#EDEFF3",
  muted: "#8B96AC",
  mutedDark: "#5D6A85",
  gold: "#C9A227",
  goldLight: "#E8C468",
  teal: "#4FD1C5",
  coral: "#F2637B",
};

const SECTOR_COLORS = {
  "Technology": "#C9A227",
  "Healthcare": "#4FD1C5",
  "Financial Services": "#7C9CF2",
  "Financials": "#7C9CF2",
  "Consumer Cyclical": "#F2637B",
  "Consumer Discretionary": "#F2637B",
  "Consumer Defensive": "#9AE6B4",
  "Consumer Staples": "#9AE6B4",
  "Energy": "#F2A65A",
  "Industrials": "#B794F4",
  "Utilities": "#63B3ED",
  "Real Estate": "#F6AD55",
  "Basic Materials": "#A0AEC0",
  "Materials": "#A0AEC0",
  "Communication Services": "#ED64A6",
};
const sectorColor = (s) => SECTOR_COLORS[s] || "#8B96AC";

const FONT_HEAD = "'Space Grotesk', sans-serif";
const FONT_MONO = "'IBM Plex Mono', monospace";
const FONT_BODY = "'IBM Plex Sans', sans-serif";

/* ============================================================
   지표 정의
   ============================================================ */
const METRIC_CONFIG = [
  { key: "per", label: "PER", category: "valuation", direction: "lower", suffix: "" },
  { key: "pbr", label: "PBR", category: "valuation", direction: "lower", suffix: "" },
  { key: "psr", label: "PSR", category: "valuation", direction: "lower", suffix: "" },
  { key: "roe", label: "ROE", category: "profitability", direction: "higher", suffix: "%" },
  { key: "profitMargin", label: "순이익률", category: "profitability", direction: "higher", suffix: "%" },
  { key: "dividendYield", label: "배당수익률", category: "profitability", direction: "higher", suffix: "%" },
  { key: "epsGrowth", label: "EPS 성장률", category: "growth", direction: "higher", suffix: "%" },
  { key: "revenueGrowth", label: "매출 성장률", category: "growth", direction: "higher", suffix: "%" },
  { key: "debtToEquity", label: "부채비율", category: "stability", direction: "lower", suffix: "" },
  { key: "currentRatio", label: "유동비율", category: "stability", direction: "higher", suffix: "" },
  { key: "beta", label: "베타", category: "stability", direction: "lower", suffix: "" },
  { key: "change52w", label: "52주 변화율", category: "momentum", direction: "higher", suffix: "%" },
];
const EXTRA_COLUMNS = [
  { key: "price", label: "주가", suffix: "" },
  { key: "marketCap", label: "시가총액", suffix: "$B" },
  { key: "eps", label: "EPS", suffix: "" },
  { key: "dividendPerShare", label: "주당배당금", suffix: "" },
];
const CATEGORIES = ["valuation", "profitability", "growth", "stability", "momentum"];
const CATEGORY_LABEL = {
  valuation: "밸류에이션", profitability: "수익성", growth: "성장성",
  stability: "안정성", momentum: "모멘텀",
};

const PRESETS = {
  balanced: { label: "균형", weights: { valuation: 0.2, profitability: 0.25, growth: 0.25, stability: 0.2, momentum: 0.1 } },
  growth: { label: "성장 중시", weights: { valuation: 0.1, profitability: 0.15, growth: 0.45, stability: 0.1, momentum: 0.2 } },
  stability: { label: "안정 중시", weights: { valuation: 0.2, profitability: 0.2, growth: 0.1, stability: 0.4, momentum: 0.1 } },
  value: { label: "밸류 중시", weights: { valuation: 0.45, profitability: 0.25, growth: 0.1, stability: 0.15, momentum: 0.05 } },
};

/* ============================================================
   점수 계산
   ============================================================ */
function computeScores(data, weights, groupBy) {
  const groups = {};
  data.forEach((d) => {
    const k = groupBy === "sector" ? d.sector : "ALL";
    (groups[k] = groups[k] || []).push(d);
  });

  const pctMap = new Map(data.map((d) => [d, {}]));
  Object.values(groups).forEach((group) => {
    METRIC_CONFIG.forEach((m) => {
      const valid = group.filter((d) => typeof d[m.key] === "number" && !Number.isNaN(d[m.key]));
      const sorted = [...valid].sort((a, b) => a[m.key] - b[m.key]);
      const n = sorted.length;
      sorted.forEach((d, idx) => {
        let p = n > 1 ? (idx / (n - 1)) * 100 : 50;
        if (m.direction === "lower") p = 100 - p;
        pctMap.get(d)[m.key] = p;
      });
      // 값이 없는 종목은 중립(50점)
      group.forEach((d) => {
        if (pctMap.get(d)[m.key] === undefined) pctMap.get(d)[m.key] = 50;
      });
    });
  });

  const scored = data.map((d) => {
    const pcts = pctMap.get(d);
    const catScores = {};
    CATEGORIES.forEach((cat) => {
      const ms = METRIC_CONFIG.filter((m) => m.category === cat);
      catScores[cat] = ms.reduce((s, m) => s + pcts[m.key], 0) / ms.length;
    });
    const score = CATEGORIES.reduce((s, cat) => s + catScores[cat] * weights[cat], 0);
    return { ...d, _pct: pcts, _cat: catScores, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);
  scored.forEach((d, i) => (d.rank = i + 1));
  return scored;
}

/* ============================================================
   유틸
   ============================================================ */
const fmt = (v, digits = 1) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(digits);
const fmtCap = (v) => {
  if (v === null || v === undefined) return "—";
  if (v >= 1000) return `$${(v / 1000).toFixed(2)}T`;
  return `$${Number(v).toFixed(1)}B`;
};
const scoreColor = (s) => (s >= 75 ? C.teal : s >= 50 ? C.goldLight : s >= 25 ? "#F2A65A" : C.coral);

function useIsNarrow(breakpoint = 900) {
  const [narrow, setNarrow] = useState(
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return narrow;
}

function downloadCSV(rows) {
  const cols = ["rank", "ticker", "company", "sector", "industry",
    ...METRIC_CONFIG.map((m) => m.key), ...EXTRA_COLUMNS.map((m) => m.key), "_score"];
  const header = cols.join(",");
  const body = rows.map((r) =>
    cols.map((c) => {
      const v = c === "_score" ? r._score.toFixed(2) : r[c];
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")
  ).join("\n");
  const blob = new Blob(["\uFEFF" + header + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sp500_ranking_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
   서브 컴포넌트
   ============================================================ */
function ScoreBar({ score }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 110 }}>
      <div style={{ flex: 1, height: 6, background: C.borderLight, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: scoreColor(score), borderRadius: 3 }} />
      </div>
      <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: scoreColor(score), width: 36, textAlign: "right" }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

function Pill({ children, color }) {
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", borderRadius: 999, border: `1px solid ${color}55`,
      color, background: `${color}18`, whiteSpace: "nowrap", fontFamily: FONT_BODY, fontWeight: 500,
    }}>
      {children}
    </span>
  );
}

function Marquee({ items }) {
  if (!items.length) return null;
  const track = [...items, ...items];
  return (
    <div style={{ overflow: "hidden", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, background: C.panel }}>
      <div className="ticker-track" style={{ display: "flex", width: "max-content", padding: "8px 0" }}>
        {track.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 20px", borderRight: `1px solid ${C.border}` }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600 }}>{d.ticker}</span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: scoreColor(d._score) }}>{d._score.toFixed(1)}</span>
            {d.change52w >= 0 ? <TrendingUp size={11} color={C.teal} /> : <TrendingDown size={11} color={C.coral} />}
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: d.change52w >= 0 ? C.teal : C.coral }}>
              {d.change52w >= 0 ? "+" : ""}{fmt(d.change52w)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontFamily: FONT_BODY, fontSize: 12, color: C.text }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{d.ticker || d.sector || d.range}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: C.muted }}>
          {p.name}: <span style={{ color: C.text, fontFamily: FONT_MONO }}>
            {typeof p.value === "number" ? p.value.toFixed(2) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   메인
   ============================================================ */
function Dashboard() {
  const [rawData, setRawData] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [failedList, setFailedList] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [errorMsg, setErrorMsg] = useState("");

  const [tab, setTab] = useState("ranking");
  const [preset, setPreset] = useState("balanced");
  const [groupBy, setGroupBy] = useState("sector");
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("전체");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [sortCol, setSortCol] = useState("per");
  const [sortDir, setSortDir] = useState("asc");
  const PAGE_SIZE = 25;
  const narrow = useIsNarrow();

  const loadData = async () => {
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch(`./sp500_metrics.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const arr = Array.isArray(json) ? json : json.data;
      if (!Array.isArray(arr) || !arr.length) throw new Error("데이터가 비어 있습니다");
      setRawData(arr);
      setUpdatedAt(json.updatedAt || null);
      setFailedList(json.failed || []);
      setPage(1);
      setStatus("ready");
    } catch (e) {
      setErrorMsg(String(e.message || e));
      setStatus("error");
    }
  };

  useEffect(() => { loadData(); }, []);

  const scored = useMemo(
    () => (rawData.length ? computeScores(rawData, PRESETS[preset].weights, groupBy) : []),
    [rawData, preset, groupBy]
  );
  const sectors = useMemo(() => ["전체", ...Array.from(new Set(rawData.map((d) => d.sector))).sort()], [rawData]);

  const filtered = useMemo(() => scored.filter((d) => {
    const q = search.toLowerCase();
    const matchSearch = !q || d.ticker.toLowerCase().includes(q) || (d.company || "").toLowerCase().includes(q);
    const matchSector = sectorFilter === "전체" || d.sector === sectorFilter;
    return matchSearch && matchSector;
  }), [scored, search, sectorFilter]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const rawSorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      if (va == null) return 1;
      if (vb == null) return -1;
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return arr;
  }, [filtered, sortCol, sortDir]);

  const top15 = scored.slice(0, 15).map((d) => ({ ticker: d.ticker, score: +d._score.toFixed(1), sector: d.sector }));

  const sectorAvg = useMemo(() => {
    const g = {};
    scored.forEach((d) => { (g[d.sector] = g[d.sector] || []).push(d._score); });
    return Object.entries(g)
      .map(([sector, arr]) => ({ sector, score: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1), n: arr.length }))
      .sort((a, b) => b.score - a.score);
  }, [scored]);

  const scatterData = useMemo(
    () => scored.filter((d) => d.per > 0 && d.per < 150).map((d) => ({ ticker: d.ticker, x: d.per, y: d.roe, z: d.marketCap, sector: d.sector })),
    [scored]
  );

  const histData = useMemo(() => {
    const b = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}-${i * 10 + 10}`, count: 0 }));
    scored.forEach((d) => { b[Math.min(9, Math.floor(d._score / 10))].count++; });
    return b;
  }, [scored]);

  const avgPER = rawData.length ? (rawData.reduce((s, d) => s + (d.per || 0), 0) / rawData.length).toFixed(1) : "—";
  const avgROE = rawData.length ? (rawData.reduce((s, d) => s + (d.roe || 0), 0) / rawData.length).toFixed(1) : "—";

  const toggleSort = (key) => {
    if (sortCol === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortCol(key); setSortDir("asc"); }
  };

  /* ---------- 로딩 / 에러 화면 ---------- */
  if (status === "loading") {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontFamily: FONT_BODY }}>
        데이터를 불러오는 중…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY, padding: 24 }}>
        <div style={{ maxWidth: 460, textAlign: "center", color: C.muted, lineHeight: 1.8 }}>
          <AlertTriangle size={28} color={C.coral} />
          <h2 style={{ color: C.text, fontFamily: FONT_HEAD, fontSize: 18, marginBottom: 6 }}>데이터를 불러오지 못했습니다</h2>
          <div style={{ fontSize: 13, marginBottom: 4 }}>{errorMsg}</div>
          <div style={{ fontSize: 13 }}>
            sp500_metrics.json 파일이 아직 생성되지 않았을 수 있습니다.
            저장소 Actions 탭에서 <b style={{ color: C.text }}>Daily S&amp;P500 Update</b> 워크플로를 한 번 실행해주세요.
          </div>
          <button onClick={loadData} style={{ marginTop: 16, background: C.gold, color: "#1A1406", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 600, cursor: "pointer", fontFamily: FONT_BODY }}>
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  /* ---------- 본 화면 ---------- */
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: FONT_BODY }}>
      {/* 헤더 */}
      <div style={{ padding: "22px 20px 16px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.gold, letterSpacing: 2, marginBottom: 4 }}>SCREENER · S&amp;P 500</div>
            <h1 style={{ fontFamily: FONT_HEAD, fontSize: narrow ? 20 : 26, fontWeight: 700, margin: 0 }}>성장 종목 발굴 대시보드</h1>
            <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
              데이터 갱신: {updatedAt ? new Date(updatedAt).toLocaleString("ko-KR") : "—"}
              <span style={{ marginLeft: 10, color: C.mutedDark }}>· {rawData.length}개 종목</span>
              {failedList.length > 0 && (
                <span style={{ marginLeft: 10, color: C.mutedDark }}>· 수집 실패 {failedList.length}건</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => downloadCSV(filtered)}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, cursor: "pointer", fontFamily: FONT_BODY }}>
              <Download size={13} /> CSV
            </button>
            <button onClick={loadData}
              style={{ display: "flex", alignItems: "center", gap: 6, background: C.gold, color: "#1A1406", border: "none", borderRadius: 8, padding: "9px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: FONT_BODY }}>
              <RefreshCw size={14} /> 새로고침
            </button>
          </div>
        </div>
      </div>

      <Marquee items={scored.slice(0, 10)} />

      {/* 요약 */}
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr 1fr" : "repeat(4, 1fr)", gap: 1, background: C.border }}>
        {[
          { label: "종목 수", value: rawData.length },
          { label: "평균 PER", value: avgPER },
          { label: "평균 ROE", value: `${avgROE}%` },
          { label: "1위 종목", value: scored[0] ? `${scored[0].ticker} (${scored[0]._score.toFixed(1)})` : "—" },
        ].map((s, i) => (
          <div key={i} style={{ background: C.panel, padding: "14px 18px" }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: narrow ? 16 : 20, fontWeight: 600 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* 컨트롤 */}
      <div style={{ padding: "14px 20px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px" }}>
          <Search size={14} color={C.muted} />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="티커 · 회사명 검색"
            style={{ background: "transparent", border: "none", outline: "none", color: C.text, fontSize: 13, width: 150, fontFamily: FONT_BODY }} />
        </div>
        <select value={sectorFilter} onChange={(e) => { setSectorFilter(e.target.value); setPage(1); }}
          style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, padding: "8px 10px", fontFamily: FONT_BODY }}>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(PRESETS).map(([k, v]) => (
            <button key={k} onClick={() => setPreset(k)} style={{
              fontSize: 12, padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontFamily: FONT_BODY, fontWeight: 500,
              border: `1px solid ${preset === k ? C.gold : C.border}`,
              background: preset === k ? `${C.gold}22` : "transparent",
              color: preset === k ? C.goldLight : C.muted,
            }}>{v.label}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {[{ k: "sector", l: "업계 대비" }, { k: "all", l: "전체 대비" }].map((o) => (
            <button key={o.k} onClick={() => setGroupBy(o.k)} style={{
              fontSize: 12, padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontFamily: FONT_BODY,
              border: `1px solid ${groupBy === o.k ? C.teal : C.border}`,
              background: groupBy === o.k ? `${C.teal}18` : "transparent",
              color: groupBy === o.k ? C.teal : C.muted,
            }}>{o.l}</button>
          ))}
        </div>
      </div>

      {/* 탭 */}
      <div style={{ display: "flex", gap: 4, padding: "0 20px", borderBottom: `1px solid ${C.border}`, overflowX: "auto" }}>
        {[{ k: "ranking", l: "랭킹" }, { k: "charts", l: "시각화" }, { k: "raw", l: "Raw Data" }].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding: "12px 16px", background: "transparent", border: "none", cursor: "pointer", whiteSpace: "nowrap",
            color: tab === t.k ? C.text : C.muted, fontFamily: FONT_HEAD, fontWeight: 600, fontSize: 14,
            borderBottom: `2px solid ${tab === t.k ? C.gold : "transparent"}`,
          }}>{t.l}</button>
        ))}
      </div>

      <div style={{ padding: 20 }}>
        {tab === "ranking" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.mutedDark, fontSize: 12, marginBottom: 12 }}>
              <Info size={13} />
              5개 카테고리의 {groupBy === "sector" ? "업계 내" : "전체 시장"} 백분위를 가중합한 점수입니다. 행을 클릭하면 상세를 볼 수 있어요.
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: C.panelAlt, color: C.muted, fontSize: 11 }}>
                      <th>순위</th><th>티커</th><th>회사명</th><th>섹터</th><th>종합점수</th>
                      <th>PER</th><th>ROE</th><th>배당</th><th>52주</th><th>시가총액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((d) => (
                      <tr key={d.ticker} onClick={() => setSelected(d)} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ fontFamily: FONT_MONO, color: C.mutedDark }}>{d.rank}</td>
                        <td style={{ fontFamily: FONT_MONO, fontWeight: 700 }}>{d.ticker}</td>
                        <td style={{ color: C.muted, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{d.company}</td>
                        <td><Pill color={sectorColor(d.sector)}>{d.sector}</Pill></td>
                        <td><ScoreBar score={d._score} /></td>
                        <td style={{ fontFamily: FONT_MONO }}>{fmt(d.per)}</td>
                        <td style={{ fontFamily: FONT_MONO }}>{fmt(d.roe)}%</td>
                        <td style={{ fontFamily: FONT_MONO }}>{fmt(d.dividendYield)}%</td>
                        <td style={{ fontFamily: FONT_MONO, color: d.change52w >= 0 ? C.teal : C.coral }}>
                          {d.change52w >= 0 ? "+" : ""}{fmt(d.change52w)}%
                        </td>
                        <td style={{ fontFamily: FONT_MONO, color: C.muted }}>{fmtCap(d.marketCap)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.muted }}>
                <span>{filtered.length}개 중 {filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, filtered.length)}</span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
                    style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: page === 1 ? C.mutedDark : C.text, padding: "4px 10px", cursor: page === 1 ? "default" : "pointer" }}>이전</button>
                  <span>{page} / {totalPages}</span>
                  <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}
                    style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: page === totalPages ? C.mutedDark : C.text, padding: "4px 10px", cursor: page === totalPages ? "default" : "pointer" }}>다음</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "charts" && (
          <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 18 }}>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, gridColumn: narrow ? "auto" : "1 / -1" }}>
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 600, marginBottom: 12 }}>종합점수 TOP 15</div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={top15} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke={C.border} vertical={false} />
                  <XAxis dataKey="ticker" tick={{ fill: C.muted, fontSize: 10, fontFamily: FONT_MONO }} axisLine={{ stroke: C.border }} tickLine={false} interval={0} angle={-45} textAnchor="end" height={50} />
                  <YAxis domain={[0, 100]} tick={{ fill: C.muted, fontSize: 11 }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: C.panelAlt }} />
                  <Bar dataKey="score" name="점수" radius={[4, 4, 0, 0]}>
                    {top15.map((d, i) => <Cell key={i} fill={sectorColor(d.sector)} />)}
                    <LabelList dataKey="score" position="top" fill={C.muted} fontSize={9} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 600, marginBottom: 12 }}>섹터별 평균 점수</div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={sectorAvg} layout="vertical" margin={{ top: 4, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid stroke={C.border} horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: C.muted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <YAxis type="category" dataKey="sector" width={130} tick={{ fill: C.muted, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: C.panelAlt }} />
                  <Bar dataKey="score" name="평균점수" radius={[0, 4, 4, 0]}>
                    {sectorAvg.map((d, i) => <Cell key={i} fill={sectorColor(d.sector)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 600, marginBottom: 12 }}>점수 분포</div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={histData} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke={C.border} vertical={false} />
                  <XAxis dataKey="range" tick={{ fill: C.muted, fontSize: 9 }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={{ stroke: C.border }} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: C.panelAlt }} />
                  <Bar dataKey="count" name="종목 수" fill={C.gold} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, gridColumn: narrow ? "auto" : "1 / -1" }}>
              <div style={{ fontFamily: FONT_HEAD, fontWeight: 600, marginBottom: 12 }}>PER vs ROE <span style={{ color: C.mutedDark, fontWeight: 400, fontSize: 12 }}>(버블 크기 = 시가총액)</span></div>
              <ResponsiveContainer width="100%" height={330}>
                <ScatterChart margin={{ top: 10, right: 20, left: -5, bottom: 14 }}>
                  <CartesianGrid stroke={C.border} />
                  <XAxis type="number" dataKey="x" name="PER" tick={{ fill: C.muted, fontSize: 11 }} axisLine={{ stroke: C.border }} tickLine={false} label={{ value: "PER", position: "insideBottom", offset: -8, fill: C.muted, fontSize: 11 }} />
                  <YAxis type="number" dataKey="y" name="ROE(%)" tick={{ fill: C.muted, fontSize: 11 }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <ZAxis type="number" dataKey="z" range={[30, 420]} />
                  <Tooltip content={<ChartTooltip />} cursor={{ strokeDasharray: "3 3", stroke: C.border }} />
                  <Scatter data={scatterData} fillOpacity={0.72}>
                    {scatterData.map((d, i) => <Cell key={i} fill={sectorColor(d.sector)} />)}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
                {sectorAvg.map((s) => (
                  <div key={s.sector} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 999, background: sectorColor(s.sector) }} />
                    <span style={{ fontSize: 11, color: C.muted }}>{s.sector}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "raw" && (
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto", maxHeight: "70vh" }}>
              <table style={{ fontSize: 12 }}>
                <thead>
                  <tr style={{ background: C.panelAlt, color: C.muted, fontSize: 10 }}>
                    <th>티커</th><th>회사명</th><th>섹터</th>
                    {[...METRIC_CONFIG, ...EXTRA_COLUMNS].map((m) => (
                      <th key={m.key} onClick={() => toggleSort(m.key)} style={{ cursor: "pointer" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                          {m.label}{m.suffix} <ArrowUpDown size={10} color={sortCol === m.key ? C.gold : C.mutedDark} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawSorted.map((d) => (
                    <tr key={d.ticker} onClick={() => setSelected(d)} style={{ borderTop: `1px solid ${C.border}`, fontFamily: FONT_MONO }}>
                      <td style={{ fontWeight: 700 }}>{d.ticker}</td>
                      <td style={{ color: C.muted, fontFamily: FONT_BODY, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis" }}>{d.company}</td>
                      <td style={{ fontFamily: FONT_BODY }}><Pill color={sectorColor(d.sector)}>{d.sector}</Pill></td>
                      {METRIC_CONFIG.map((m) => (
                        <td key={m.key} style={{ color: (d._imputed || []).includes(m.key) ? C.mutedDark : C.text }}>
                          {fmt(d[m.key])}{m.suffix}
                        </td>
                      ))}
                      <td>{fmt(d.price)}</td>
                      <td>{fmtCap(d.marketCap)}</td>
                      <td>{fmt(d.eps)}</td>
                      <td>{fmt(d.dividendPerShare)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "10px 16px", borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.muted }}>
              총 {rawSorted.length}개 · 헤더 클릭 시 정렬 · 회색 숫자는 섹터 중앙값으로 보정된 값입니다
            </div>
          </div>
        )}
      </div>

      {/* 상세 모달 */}
      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, background: "#000A", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, width: "100%", maxWidth: 640, maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: 20, borderBottom: `1px solid ${C.border}`, gap: 10 }}>
              <div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 22, fontWeight: 700 }}>{selected.ticker}</div>
                <div style={{ color: C.muted, fontSize: 13 }}>{selected.company}</div>
                <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Pill color={sectorColor(selected.sector)}>{selected.sector}</Pill>
                  {selected.industry && <Pill color={C.mutedDark}>{selected.industry}</Pill>}
                </div>
              </div>
              <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <div style={{ fontSize: 11, color: C.muted }}>종합순위</div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 18, color: scoreColor(selected._score) }}>
                  #{selected.rank} · {selected._score.toFixed(1)}
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ padding: 20 }}>
              <ResponsiveContainer width="100%" height={250}>
                <RadarChart data={CATEGORIES.map((c) => ({ category: CATEGORY_LABEL[c], value: +selected._cat[c].toFixed(1) }))}>
                  <PolarGrid stroke={C.border} />
                  <PolarAngleAxis dataKey="category" tick={{ fill: C.muted, fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fill: C.mutedDark, fontSize: 9 }} />
                  <Radar dataKey="value" stroke={C.gold} fill={C.gold} fillOpacity={0.35} />
                </RadarChart>
              </ResponsiveContainer>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8, marginTop: 10 }}>
                {[...METRIC_CONFIG, ...EXTRA_COLUMNS].map((m) => (
                  <div key={m.key} style={{ background: C.panelAlt, borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 10, color: C.muted }}>{m.label}</div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 14 }}>
                      {m.key === "marketCap" ? fmtCap(selected.marketCap) : `${fmt(selected[m.key])}${m.suffix}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: "20px", borderTop: `1px solid ${C.border}`, color: C.mutedDark, fontSize: 11, lineHeight: 1.7 }}>
        데이터 출처: Yahoo Finance (yfinance). 투자 판단의 근거로 사용하기 전 원본 공시를 확인하세요. 이 화면은 투자 자문이 아닙니다.
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Dashboard />);
