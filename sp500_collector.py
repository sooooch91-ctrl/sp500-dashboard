"""
S&P500 지표 수집 스크립트 (GitHub Actions 자동 실행용)
======================================================

동작:
  1. 위키피디아에서 S&P500 종목 리스트를 가져온다
  2. yfinance로 각 종목의 핵심 15개 지표를 수집한다
  3. public/sp500_metrics.json 으로 저장한다
     -> GitHub Pages에 배포된 대시보드가 이 파일을 자동으로 읽는다

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

import pandas as pd
import yfinance as yf

# ---------------------------------------------------------------
# 경로 설정: 이 파일이 scripts/ 안에 있으므로 상위의 public/ 을 가리킨다
# ---------------------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(ROOT, "public")
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "sp500_metrics.json")

DELAY = float(os.environ.get("SP500_DELAY", "0.35"))
LIMIT = int(os.environ.get("SP500_LIMIT", "0"))  # 0이면 전체


def get_sp500_tickers():
    """위키피디아에서 S&P500 종목 리스트를 가져온다."""
    url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
    tables = pd.read_html(url)
    df = tables[0]
    # 야후 파이낸스는 '.'을 '-'로 표기 (예: BRK.B -> BRK-B)
    df["Symbol"] = df["Symbol"].astype(str).str.replace(".", "-", regex=False)
    records = df[["Symbol", "Security"]].to_dict("records")
    return records[:LIMIT] if LIMIT > 0 else records


def pct(value):
    """0~1 사이 소수 비율을 % 단위로 변환. 이미 % 스케일인 값은 그대로 둔다."""
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return round(v * 100, 2) if -1 <= v <= 1 else round(v, 2)


def num(value, digits=2):
    if value is None:
        return None
    try:
        return round(float(value), digits)
    except (TypeError, ValueError):
        return None


def collect_one(ticker):
    """한 종목의 지표를 수집한다. 실패하면 None."""
    try:
        info = yf.Ticker(ticker).info
        if not info or not info.get("longName"):
            return None

        return {
            "ticker": ticker,
            "company": info.get("longName") or info.get("shortName") or ticker,
            "sector": info.get("sector") or "Unknown",
            "industry": info.get("industry") or "Unknown",
            # 밸류에이션
            "per": num(info.get("trailingPE")),
            "pbr": num(info.get("priceToBook")),
            "psr": num(info.get("priceToSalesTrailing12Months")),
            # 수익성
            "roe": pct(info.get("returnOnEquity")),
            "profitMargin": pct(info.get("profitMargins")),
            "dividendYield": pct(info.get("dividendYield")),
            # 성장성
            "epsGrowth": pct(info.get("earningsGrowth")),
            "revenueGrowth": pct(info.get("revenueGrowth")),
            # 안정성
            "debtToEquity": num(info.get("debtToEquity")),
            "currentRatio": num(info.get("currentRatio")),
            "beta": num(info.get("beta")),
            # 모멘텀
            "change52w": pct(info.get("52WeekChange")),
            # 참고 (점수 미반영)
            "marketCap": num((info.get("marketCap") or 0) / 1e9, 2),  # 단위: $B
            "eps": num(info.get("trailingEps")),
            "dividendPerShare": num(info.get("dividendRate")),
            "price": num(info.get("currentPrice") or info.get("regularMarketPrice")),
        }
    except Exception as e:
        print(f"  ! {ticker} 수집 실패: {e}", flush=True)
        return None


def fill_missing(results):
    """
    누락된 지표를 같은 섹터 중앙값으로 보정한다.
    (점수 계산 시 결측치가 많으면 순위가 왜곡되므로)
    보정된 항목은 _imputed 리스트에 기록해 대시보드에서 구분 표시한다.
    """
    metric_keys = [
        "per", "pbr", "psr", "roe", "profitMargin", "dividendYield",
        "epsGrowth", "revenueGrowth", "debtToEquity", "currentRatio",
        "beta", "change52w",
    ]

    by_sector = {}
    for r in results:
        by_sector.setdefault(r["sector"], []).append(r)

    def median(values):
        vals = sorted(v for v in values if v is not None)
        if not vals:
            return None
        mid = len(vals) // 2
        return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2

    for sector, group in by_sector.items():
        for key in metric_keys:
            med = median([g[key] for g in group])
            if med is None:
                # 섹터 전체가 비어있으면 전체 중앙값 사용
                med = median([r[key] for r in results]) or 0
            for g in group:
                if g[key] is None:
                    g[key] = round(med, 2)
                    g.setdefault("_imputed", []).append(key)
    return results


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
            if i % 25 == 0 or i == total:
                print(f"[{i}/{total}] 진행 중... (수집 {len(results)}건)", flush=True)
        else:
            failed.append(ticker)
        time.sleep(DELAY)

    if not results:
        print("수집된 데이터가 없습니다. 종료 코드 1로 실패 처리합니다.", flush=True)
        sys.exit(1)

    # 결측치 보정
    results = fill_missing(results)

    output = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "count": len(results),
        "failed": failed,
        "data": results,
    }

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n완료: {len(results)}개 종목 저장 -> {OUTPUT_PATH}", flush=True)
    if failed:
        print(f"수집 실패 {len(failed)}건: {', '.join(failed[:20])}"
              f"{' ...' if len(failed) > 20 else ''}", flush=True)


if __name__ == "__main__":
    main()
