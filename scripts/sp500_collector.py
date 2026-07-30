"""
S&P500 지표 수집 스크립트 (GitHub Actions 자동 실행용)
======================================================

v2 주요 수정 (2026-07)
  - 배당수익률: yfinance 값을 그대로 쓰지 않고 (연배당금 / 주가 * 100)으로 직접 계산.
    yfinance 버전에 따라 dividendYield가 소수(0.0026)인지 퍼센트(0.26)인지 달라져
    100배 오류가 발생했음. 직접 계산하면 버전에 무관하게 항상 정확하다.
  - 비율 필드(ROE/순이익률/성장률/52주변화율): "크기로 단위를 추측"하는 방식을 폐기.
    yfinance는 이 필드들을 항상 소수로 주므로 무조건 100배 한다.
    기존 방식은 1.0을 넘는 값(성장률 +150%, 52주 +135% 등)을 1/100로 찌그러뜨려
    성장·모멘텀 상위권 순위를 뒤집어 놓았다.
  - PER/PBR/PSR/부채비율: 0 이하 값은 결측 처리. "낮을수록 좋음" 점수 체계에서
    음수가 최고점을 받아 적자·자본잠식 기업이 1위로 올라오는 문제를 막는다.
  - 실행 마지막에 지표별 검증 리포트를 출력. 이상치가 있으면 로그에서 바로 보인다.

동작:
  1. S&P500 종목 리스트를 가져온다 (위키피디아 -> 실패 시 GitHub CSV 백업)
  2. yfinance로 각 종목의 핵심 지표를 수집한다
  3. public/sp500_metrics.json 으로 저장한다

로컬 테스트:
  pip install -r requirements.txt
  python scripts/sp500_collector.py

환경변수 (선택):
  SP500_LIMIT   - 테스트용. 예: SP500_LIMIT=20 이면 앞 20종목만 수집
  SP500_DELAY   - 종목 간 대기 시간(초). 기본 0.35
"""

import json
import os
import sys
import time
from datetime import datetime, timezone
from io import StringIO

import pandas as pd
import requests
import yfinance as yf

# ---------------------------------------------------------------
# 경로 설정: 이 파일이 scripts/ 안에 있으므로 상위의 public/ 을 가리킨다
# ---------------------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(ROOT, "public")
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "sp500_metrics.json")

DELAY = float(os.environ.get("SP500_DELAY", "0.35"))
LIMIT = int(os.environ.get("SP500_LIMIT", "0"))  # 0이면 전체

# 위키피디아 등은 User-Agent가 없는 요청을 403으로 차단한다.
# pandas.read_html은 헤더를 붙이지 못하므로 requests로 직접 받아온 뒤 파싱한다.
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
BACKUP_CSV_URLS = [
    "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv",
    "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv",
]

# 점수에 쓰이는 12개 지표
METRIC_KEYS = [
    "per", "pbr", "psr", "roe", "profitMargin", "dividendYield",
    "epsGrowth", "revenueGrowth", "debtToEquity", "currentRatio",
    "beta", "change52w",
]

# 검증용 상식 범위 (벗어나면 로그에 경고를 남긴다. 값을 버리지는 않는다.)
SANE_RANGE = {
    "per": (0, 300),
    "pbr": (0, 100),
    "psr": (0, 100),
    "roe": (-500, 300),
    "profitMargin": (-1000, 100),
    "dividendYield": (0, 25),
    "epsGrowth": (-1000, 1000),
    "revenueGrowth": (-100, 1000),
    "debtToEquity": (0, 2000),
    "currentRatio": (0, 30),
    "beta": (-2, 5),
    "change52w": (-100, 1000),
}


# ===============================================================
# 종목 리스트
# ===============================================================
def _fetch(url, tries=3):
    """헤더를 붙여 URL을 가져온다. 실패 시 잠깐 쉬고 재시도."""
    last_error = None
    for attempt in range(1, tries + 1):
        try:
            resp = requests.get(url, headers=HTTP_HEADERS, timeout=30)
            resp.raise_for_status()
            return resp.text
        except Exception as e:  # noqa: BLE001
            last_error = e
            print(f"  ! 요청 실패({attempt}/{tries}) {url} -> {e}", flush=True)
            time.sleep(3 * attempt)
    raise RuntimeError(f"가져오기 실패: {url} ({last_error})")


def _normalize(df, symbol_col, name_col):
    df = df.rename(columns={symbol_col: "Symbol", name_col: "Security"})
    df = df[["Symbol", "Security"]].dropna()
    # 야후 파이낸스는 '.'을 '-'로 표기 (예: BRK.B -> BRK-B)
    df["Symbol"] = df["Symbol"].astype(str).str.strip().str.replace(".", "-", regex=False)
    df["Security"] = df["Security"].astype(str).str.strip()
    return df


def get_sp500_tickers():
    """S&P500 종목 리스트를 가져온다. 위키피디아 우선, 실패하면 CSV 백업."""
    df = None

    try:
        html = _fetch(WIKI_URL)
        tables = pd.read_html(StringIO(html))
        for table in tables:
            cols = [str(c) for c in table.columns]
            if "Symbol" in cols and "Security" in cols:
                df = _normalize(table, "Symbol", "Security")
                break
        if df is not None:
            print(f"위키피디아에서 {len(df)}개 종목 확인", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"위키피디아 실패, 백업 소스로 전환: {e}", flush=True)

    if df is None or df.empty:
        for url in BACKUP_CSV_URLS:
            try:
                csv_text = _fetch(url, tries=2)
                raw = pd.read_csv(StringIO(csv_text))
                name_col = "Name" if "Name" in raw.columns else "Security"
                df = _normalize(raw, "Symbol", name_col)
                print(f"백업 소스에서 {len(df)}개 종목 확인", flush=True)
                break
            except Exception as e:  # noqa: BLE001
                print(f"  ! 백업 소스 실패: {e}", flush=True)

    if df is None or df.empty:
        raise RuntimeError("S&P500 종목 리스트를 어디서도 가져오지 못했습니다.")

    records = df.to_dict("records")
    return records[:LIMIT] if LIMIT > 0 else records


# ===============================================================
# 단위 변환 (여기가 v2의 핵심 수정 지점)
# ===============================================================
def to_float(value):
    """숫자로 바꿀 수 없으면 None."""
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    # NaN / inf 걸러내기
    if v != v or v in (float("inf"), float("-inf")):
        return None
    return v


def frac_to_pct(value, digits=2):
    """
    yfinance가 '소수 비율'로 주는 필드를 % 로 변환한다.
    (returnOnEquity, profitMargins, earningsGrowth, revenueGrowth, 52WeekChange)

    중요: 크기를 보고 단위를 추측하지 않는다. 무조건 100배 한다.
    기존 코드는 |값| > 1 이면 이미 %라고 가정했는데, 성장률 +150%(=1.5)나
    52주 +135%(=1.35) 같은 정상적인 값이 그 조건에 걸려 1.5%, 1.35%로
    찌그러졌다. 그 결과 성장·모멘텀 최상위권이 최하위로 뒤집혔다.
    """
    v = to_float(value)
    if v is None:
        return None
    return round(v * 100, digits)


def num(value, digits=2):
    v = to_float(value)
    return None if v is None else round(v, digits)


def positive_only(value, digits=2):
    """
    '낮을수록 좋음' 지표(PER/PBR/PSR/부채비율)용.
    0 이하이면 None(결측)으로 처리한다.

    이유: 적자기업은 PER이 음수로 나온다. 그대로 두면 '가장 낮은 PER'이 되어
    점수 체계에서 1위를 차지한다. 자본잠식 기업의 음수 부채비율도 똑같이
    '가장 안전한 기업'으로 뒤집힌다.
    """
    v = to_float(value)
    if v is None or v <= 0:
        return None
    return round(v, digits)


def compute_dividend_yield(info, price):
    """
    배당수익률(%)을 직접 계산한다.

    yfinance의 dividendYield 필드는 버전/시점에 따라 소수(0.0026)일 때도 있고
    이미 퍼센트(0.26)일 때도 있어서, 그대로 쓰면 100배 오류가 난다.
    (구글 배당률이 26%로 표시된 원인이 바로 이것)

    따라서 연배당금 / 주가 * 100 으로 직접 계산하고,
    배당금 정보가 없을 때만 yfinance 필드를 보수적으로 해석한다.
    """
    rate = to_float(info.get("dividendRate"))
    p = to_float(price)

    # 1순위: 연배당금 / 주가 (단위 모호성이 없다)
    if rate is not None and p is not None and p > 0:
        if rate <= 0:
            return 0.0
        return round(rate / p * 100, 2)

    # 2순위: 후행 배당금으로 재시도
    trailing_rate = to_float(info.get("trailingAnnualDividendRate"))
    if trailing_rate is not None and p is not None and p > 0:
        return round(max(trailing_rate, 0) / p * 100, 2)

    # 3순위: yfinance 필드를 쓸 수밖에 없는 경우.
    # trailingAnnualDividendYield는 항상 소수 형태이므로 이쪽을 먼저 본다.
    trailing_yield = to_float(info.get("trailingAnnualDividendYield"))
    if trailing_yield is not None:
        return round(max(trailing_yield, 0) * 100, 2)

    raw = to_float(info.get("dividendYield"))
    if raw is None:
        return None
    if raw <= 0:
        return 0.0
    # 소수(0.0035=0.35%)인지 퍼센트(3.5%)인지 판별.
    # S&P500 종목의 배당률이 25%를 넘는 경우는 없으므로, 25 초과면 소수로 간주.
    return round(raw * 100, 2) if raw < 0.25 else round(raw, 2)


# ===============================================================
# 종목별 수집
# ===============================================================
def collect_one(ticker, tries=2):
    """한 종목의 지표를 수집한다. 실패하면 None."""
    for attempt in range(1, tries + 1):
        try:
            info = yf.Ticker(ticker).info
            if not info or not (info.get("longName") or info.get("shortName")):
                return None

            price = to_float(info.get("currentPrice")) \
                or to_float(info.get("regularMarketPrice")) \
                or to_float(info.get("previousClose"))

            record = {
                "ticker": ticker,
                "company": info.get("longName") or info.get("shortName") or ticker,
                "sector": info.get("sector") or "Unknown",
                "industry": info.get("industry") or "Unknown",

                # --- 밸류에이션 (낮을수록 좋음 / 0 이하는 결측 처리) ---
                "per": positive_only(info.get("trailingPE")),
                "pbr": positive_only(info.get("priceToBook")),
                "psr": positive_only(info.get("priceToSalesTrailing12Months")),

                # --- 수익성 (소수 -> %) ---
                "roe": frac_to_pct(info.get("returnOnEquity")),
                "profitMargin": frac_to_pct(info.get("profitMargins")),
                "dividendYield": compute_dividend_yield(info, price),

                # --- 성장성 (소수 -> %) ---
                "epsGrowth": frac_to_pct(info.get("earningsGrowth")),
                "revenueGrowth": frac_to_pct(info.get("revenueGrowth")),

                # --- 안정성 ---
                # debtToEquity는 yfinance가 이미 % 스케일(예: 150.5)로 준다. 100배 금지.
                "debtToEquity": positive_only(info.get("debtToEquity")),
                "currentRatio": num(info.get("currentRatio")),
                "beta": num(info.get("beta")),

                # --- 모멘텀 (소수 -> %) ---
                "change52w": frac_to_pct(info.get("52WeekChange")),

                # --- 참고 (점수 미반영) ---
                "marketCap": num(to_float(info.get("marketCap")) / 1e9, 2)
                if to_float(info.get("marketCap")) else None,
                "eps": num(info.get("trailingEps")),
                "dividendPerShare": num(info.get("dividendRate")),
                "price": num(price),
            }

            # 적자/자본잠식 여부를 별도 표시 (대시보드에서 경고 배지로 쓸 수 있음)
            flags = []
            eps = to_float(info.get("trailingEps"))
            if eps is not None and eps < 0:
                flags.append("적자")
            if to_float(info.get("trailingPE")) is not None \
                    and to_float(info.get("trailingPE")) <= 0:
                flags.append("PER음수")
            if to_float(info.get("priceToBook")) is not None \
                    and to_float(info.get("priceToBook")) <= 0:
                flags.append("자본잠식")
            if flags:
                record["_flags"] = flags

            return record

        except Exception as e:  # noqa: BLE001
            if attempt < tries:
                time.sleep(2)
                continue
            print(f"  ! {ticker} 수집 실패: {e}", flush=True)
            return None
    return None


# ===============================================================
# 결측치 보정
# ===============================================================
def fill_missing(results):
    """
    누락된 지표를 같은 섹터 중앙값으로 보정한다.
    보정된 항목은 _imputed 리스트에 기록해 대시보드에서 회색으로 구분 표시한다.
    """
    by_sector = {}
    for r in results:
        by_sector.setdefault(r["sector"], []).append(r)

    def median(values):
        vals = sorted(v for v in values if v is not None)
        if not vals:
            return None
        mid = len(vals) // 2
        return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2

    for group in by_sector.values():
        for key in METRIC_KEYS:
            med = median([g[key] for g in group])
            if med is None:
                med = median([r[key] for r in results]) or 0
            for g in group:
                if g[key] is None:
                    g[key] = round(med, 2)
                    g.setdefault("_imputed", []).append(key)
    return results


# ===============================================================
# 검증 리포트
# ===============================================================
def validate(results):
    """지표별 분포를 출력하고 상식 범위를 벗어난 값에 경고를 남긴다."""
    print("\n" + "=" * 72, flush=True)
    print("데이터 검증 리포트", flush=True)
    print("=" * 72, flush=True)
    print(f"{'지표':16}{'유효':>6}{'보정':>6}{'최소':>11}{'중앙':>11}{'최대':>11}", flush=True)
    print("-" * 72, flush=True)

    warnings = []
    for key in METRIC_KEYS:
        imputed = sum(1 for r in results if key in r.get("_imputed", []))
        vals = sorted(r[key] for r in results
                      if r.get(key) is not None and key not in r.get("_imputed", []))
        if not vals:
            print(f"{key:16}{0:>6}{imputed:>6}{'-':>11}{'-':>11}{'-':>11}", flush=True)
            warnings.append(f"{key}: 유효값이 하나도 없음 (필드명 변경 의심)")
            continue

        mid = len(vals) // 2
        med = vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2
        lo, hi = vals[0], vals[-1]
        print(f"{key:16}{len(vals):>6}{imputed:>6}{lo:>11.2f}{med:>11.2f}{hi:>11.2f}",
              flush=True)

        smin, smax = SANE_RANGE[key]
        if lo < smin:
            warnings.append(f"{key}: 최소값 {lo:.2f} 이 기대범위({smin}) 미달")
        if hi > smax:
            warnings.append(f"{key}: 최대값 {hi:.2f} 이 기대범위({smax}) 초과")
        if imputed > len(results) * 0.5:
            warnings.append(f"{key}: 절반 이상({imputed}건)이 보정값 — 수집 실패 의심")

    # 배당률 교차 검증: 배당금이 0인데 배당률이 0보다 크면 단위 오류
    bad_div = [r["ticker"] for r in results
               if not r.get("dividendPerShare") and (r.get("dividendYield") or 0) > 0.5
               and "dividendYield" not in r.get("_imputed", [])]
    if bad_div:
        warnings.append(f"배당금 없는데 배당률>0.5%인 종목 {len(bad_div)}건: "
                        f"{', '.join(bad_div[:8])}")

    flagged = sum(1 for r in results if r.get("_flags"))
    print("-" * 72, flush=True)
    print(f"적자/자본잠식 표시 종목: {flagged}건", flush=True)

    if warnings:
        print("\n[경고]", flush=True)
        for w in warnings:
            print(f"  - {w}", flush=True)
    else:
        print("\n이상치 경고 없음.", flush=True)
    print("=" * 72 + "\n", flush=True)


# ===============================================================
def main():
    print("S&P500 종목 리스트 가져오는 중...", flush=True)
    companies = get_sp500_tickers()
    total = len(companies)
    print(f"총 {total}개 종목 확인. 지표 수집 시작 (딜레이 {DELAY}초)\n", flush=True)

    results = []
    failed = []
    for i, row in enumerate(companies, 1):
        ticker = row["Symbol"]
        data = collect_one(ticker)
        if data:
            results.append(data)
        else:
            failed.append(ticker)
        if i % 25 == 0 or i == total:
            print(f"[{i}/{total}] 진행 중... (수집 {len(results)}건 / 실패 {len(failed)}건)",
                  flush=True)
        time.sleep(DELAY)

    if not results:
        print("수집된 데이터가 없습니다. 종료 코드 1로 실패 처리합니다.", flush=True)
        sys.exit(1)

    results = fill_missing(results)
    validate(results)

    output = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "schemaVersion": 2,
        "count": len(results),
        "failed": failed,
        "data": results,
    }

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"완료: {len(results)}개 종목 저장 -> {OUTPUT_PATH}", flush=True)
    if failed:
        print(f"수집 실패 {len(failed)}건: {', '.join(failed[:20])}"
              f"{' ...' if len(failed) > 20 else ''}", flush=True)


if __name__ == "__main__":
    main()
