"""[품감] 회계법인 사업보고서 해석 — 브라우저(Pyodide)판 (자동 생성, 손으로 고치지 말 것).
원본: backend/src/gumiho/integrations/external/dart_firm.py · dart_accounts.py · dart_finance.py 의 순수 함수(그대로 복사).
네트워크(OpenDART)는 구글 Apps Script 중계가 맡고, 여기서는 document.xml(zip) → (붙임1) 값만 만든다."""
from __future__ import annotations

import base64
import io
import json
import re
import zipfile
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from lxml import etree


class DartError(Exception):
    """담당자에게 그대로 보여 줄 수 있는 문장을 담는다."""


MAX_DOCUMENT = 32 * 1024 * 1024
MAX_UNPACKED = 64 * 1024 * 1024
UNIT = re.compile(r"단위\s*[:：]?\s*(백만원|천원|원)")


def amount(value: str) -> Decimal | None:
    """표의 한 칸 → 금액. 읽을 수 없으면 `None`(추측하지 않는다).

    `△`·`▲`·`(1,234)` 는 음수다. `-` 한 글자는 0 이다(비어 있음이 아니라 「없음」).
    """
    text = re.sub(r"\s+", "", str(value))
    if not text:
        return None
    if text in ("-", "—", "–"):
        return Decimal(0)
    if not re.fullmatch(r"[△▲−-]?\(?[\d,]+(?:\.\d+)?\)?", text):
        return None
    negative = bool(re.match(r"[△▲−(-]", text))
    return Decimal(re.sub(r"[^\d.]", "", text)) * (-1 if negative else 1)


def _text(element: Any) -> str:
    return " ".join("".join(element.itertext()).split())


def _label(value: str) -> str:
    """계정과목 이름 씻기 — 주석 번호·로마숫자·괄호·가운뎃점을 걷는다."""
    text = re.sub(r"\([^)]*주[^)]*\)|\(주석[^)]*\)", "", value)
    # 「(1) 자본금」·「1) 자본금」·「① 자본금」·「가. 자본금」 — 앞의 번호를 뗀다(석미건설㈜ 연결: 「(1) 자본금」이 「1자본금」이 되어 못 읽었다)
    text = re.sub(r"^\s*(?:[(（]\s*(?:\d+|[가-힣])\s*[)）]|\d+\s*\)|[①-⑳]|[가-힣]\s*\.(?!\d))\s*", "", text)
    text = re.sub(r"^[\sⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫIVX\d.]+", "", text)
    return re.sub(r"[\s()·ㆍ]", "", text)


def _cells(row: Any) -> list[str]:
    out: list[str] = []
    for cell in row:
        if cell.tag in ("TD", "TE", "TH", "TU"):
            out += [_text(cell)] * int(cell.get("COLSPAN", "1") or 1)
    return out


def _before(table: Any, limit: int = 4) -> str:
    """표 앞의 글(단위·당기/전기·제목). 같은 구역의 앞 형제 몇 개만 본다."""
    parts: list[str] = []
    node = table.getprevious()
    while node is not None and len(parts) < limit:
        if node.tag == "TABLE":
            # 테두리 없는 머리 표(단위만 적은 표)는 글로 친다. 자료 표를 만나면 멈춘다.
            if node.find(".//THEAD") is not None or len(list(node.iter("TR"))) > 3:
                break
        text = _text(node)
        if text:
            parts.append(text)
        node = node.getprevious()
    group = table.getparent()
    if group is not None:
        parts += [_text(e) for e in group.findall("./TITLE")]
    return " ".join(parts)


PARSER_VERSION = 8   # 8: 품질관리실장 출처 문구 짧게 · … · 6: 품질관리 담당 이사 · 7: 품질관리실장(명시된 이름 → 작성책임자 → 대표이사와 같으면 (확인필)) · … · 4: 분사무소 구·동 · 5: 부문별 합계와 영업수익의 1~3백만원 단수차이는 「컨설팅 등」에서 맞춤
FIRM_WORD = re.compile(r"회계법인")
REPORT_RE = re.compile(r"회계법인사업보고서\s*\((\d{4})\.(\d{2})\)")
BIZ_WORD = re.compile(r"사\s*업\s*보\s*고\s*서")
WON = {"원": Decimal(1), "천원": Decimal(1000), "백만원": Decimal(1_000_000)}


def _squash(text: str) -> str:
    return re.sub(r"[\s()·ㆍ・,]", "", str(text or ""))


def _num(text: str) -> Decimal | None:
    """숫자 칸(금액·건수·비율). `-` 는 0."""
    return amount(str(text or "").replace("%", ""))


def _is_num(text: str) -> bool:
    return _num(text) is not None and bool(re.search(r"\d", str(text))) or _squash(text) in ("-", "—", "–")


# ── 1. 회계법인 찾기 ────────────────────────────────────────────────────────


# ── 표 읽기 ────────────────────────────────────────────────────────────────

class _Table:
    def __init__(self, node: Any, ctx: str):
        self.node = node
        self.ctx = ctx
        self.ctx_sq = _squash(ctx)
        self.rows: list[list[str]] = [_cells(tr) for tr in node.iter("TR")]
        self.rows = [r for r in self.rows if any(c.strip() for c in r)]

    def __repr__(self) -> str:
        return f"<표 {self.ctx[:40]!r} {len(self.rows)}행>"


def _context(table: Any) -> str:
    """표의 앞글: 앞 형제 글(_before) + 조상 구역의 TITLE(3단계) + 바로 앞의 캡션 표(행 ≤3, 「재 무 상 태 표 / 제57기 …」).
    회계법인 사업보고서는 표가 TABLE-GROUP > LIBRARY 안에 들어 있어 형제만 보면 아무 글도 없다."""
    parts = [_before(table)]
    prev = table.getprevious()
    hops = 0
    while prev is not None and hops < 2:
        if prev.tag == "TABLE" and len(list(prev.iter("TR"))) <= 3:
            parts.append(_text(prev))
        prev = prev.getprevious()
        hops += 1
    node = table.getparent()
    depth = 0
    while node is not None and depth < 4:
        parts += [_text(e) for e in node.findall("./TITLE")]
        node = node.getparent()
        depth += 1
    return " ".join(p for p in parts if p)


def _tables(root: Any) -> list[_Table]:
    return [_Table(t, _context(t)) for t in root.iter("TABLE")]


def _find(tables: list[_Table], pattern: str, *, min_rows: int = 2, exclude: str = "", need: str = "") -> _Table | None:
    """앞글이 pattern 에 맞는 첫 표. `need` 는 표 안 글(빈칸 뺀 것)에 꼭 있어야 하는 말 — 캡션만 든 표(「재 무 상 태 표 / 제57기 …」)를 건너뛰려고."""
    rx = re.compile(pattern)
    ex = re.compile(exclude) if exclude else None
    nd = re.compile(need) if need else None
    for t in tables:
        if len(t.rows) < min_rows or not rx.search(t.ctx_sq):
            continue
        if ex and ex.search(t.ctx_sq):
            continue
        if nd and not nd.search(_squash(" ".join(c for r in t.rows for c in r))):
            continue
        return t
    return None


def _split_row(cells: list[str]) -> tuple[list[str], list[str]]:
    """앞의 글 칸(라벨)과 뒤의 숫자 칸. 빈 칸은 숫자 쪽에 넣지 않는다(라벨 뒤 빈 칸 건너뜀)."""
    labels: list[str] = []
    k = 0
    while k < len(cells) and not _is_num(cells[k]):
        if cells[k].strip():
            labels.append(cells[k].strip())
        k += 1
    nums = [c for c in cells[k:] if c.strip()]
    return labels, nums


def _district(addr: str) -> str:
    """주소에서 시·도 다음의 구·군·읍·면·동 이름(「서울특별시 강남구 테헤란로」→「강남」, 「부산시 서면」→「서면」)."""
    toks = str(addr or "").replace(",", " ").split()
    big = ("서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종")
    for t in toks[1:4]:
        m = re.fullmatch(r"([가-힣]{2,6})(구|군)", t)          # 강남구 → 강남 · 단원구 → 단원
        if m and m.group(1) not in big:
            return m.group(1)
    for t in toks[1:4]:
        m = re.fullmatch(r"([가-힣]{2,6})(읍|면|동)", t)       # 서면 → 서면 · 여의도동 → 여의도
        if m:
            return t if m.group(2) in ("읍", "면") else m.group(1)
    if len(toks) > 1 and re.fullmatch(r"[가-힣]{2,8}", toks[1]):
        return re.sub(r"(시|군|구)$", "", toks[1]) or toks[1]   # 동대구시 → 동대구
    return ""


def _unit_of(ctx: str) -> Decimal:
    m = UNIT.search(ctx)
    return WON[m.group(1)] if m else WON["원"]


def _mn(value: Decimal | None, unit: Decimal) -> int | None:
    if value is None:
        return None
    return int((value * unit / Decimal(1_000_000)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _period_columns(header_rows: list[list[str]]) -> list[str]:
    """머리글에서 열마다 당기/전기/전전기 표시. 「제 57(당) 기」·「당 기」·「제57기(당기)2025.04.01~」 모두."""
    cols: list[str] = []
    for row in header_rows:
        for k, cell in enumerate(row):
            sq = _squash(cell)
            tag = "cur" if re.search(r"\(당\)|당기|당\s*기", cell) and "전전" not in sq else ("prev2" if "전전" in sq else ("prev" if re.search(r"\(전\)|전기|전\s*기", cell) else ""))
            if tag:
                while len(cols) <= k:
                    cols.append("")
                if not cols[k]:
                    cols[k] = tag
    return cols


def _statement_values(table: _Table, wants: dict[str, str]) -> dict[str, dict[str, Decimal | None]]:
    """재무상태표·손익계산서: {필드: {cur, prev}}. 값 칸이 둘(들여쓰기)로 나뉘어도 그 기간 묶음의 첫 숫자를 쓴다."""
    head = [r for r in table.rows[:3] if any(re.search(r"당|전|기", c) for c in r)]
    cols = _period_columns(head)
    out: dict[str, dict[str, Decimal | None]] = {}
    for row in table.rows:
        if not row or not row[0].strip():
            continue
        label = _squash(_label(row[0]))   # 「Ⅰ.영업수익」·「(1) 자본금」 → 영업수익·자본금(dart_finance._label)
        for field, pat in wants.items():
            if field in out or not re.fullmatch(pat, label):
                continue
            got: dict[str, Decimal | None] = {"cur": None, "prev": None}
            for k, cell in enumerate(row[1:], start=1):
                tag = cols[k] if k < len(cols) else ""
                if tag in ("cur", "prev") and got[tag] is None:
                    v = _num(cell)
                    if v is not None and re.search(r"\d", cell):
                        got[tag] = v
            if got["cur"] is None and got["prev"] is None:
                nums = [_num(c) for c in row[1:] if re.search(r"\d", c)]
                nums = [n for n in nums if n is not None]
                if nums:
                    got = {"cur": nums[0], "prev": nums[1] if len(nums) > 1 else None}
            if "손실" in label and "이익" not in label:   # 「당기순손실」 행에 양수로 적힌 금액은 손실(음수)이다 — 화면·서식은 △로 보인다
                got = {k: (-v if v is not None and v > 0 else v) for k, v in got.items()}
            out[field] = got
    return out


def parse_firm_report(raw: bytes, rcept_no: str) -> dict[str, Any]:
    """회계법인 사업보고서 본문 XML → (붙임1) 감사인 개요에 필요한 값. 순수 함수."""
    parser = etree.XMLParser(recover=True, resolve_entities=False, no_network=True, huge_tree=True)
    root = etree.fromstring(raw, parser)
    if root is None:
        raise DartError("원문 XML 을 읽지 못했습니다.")
    tables = _tables(root)
    warnings: list[str] = []
    sources: dict[str, str] = {}
    full_text = _text(root)

    def warn(msg: str) -> None:
        warnings.append(msg)

    # 기수·사업연도(표지): 「사 업 보 고 서 (제 57 기)」 · 「사업연도 2025년 04월 01일 부터 2026년 03월 31일 까지」
    term = None
    m = re.search(r"\(\s*제\s*(\d+)\s*기\s*\)", full_text)
    if m:
        term = int(m.group(1))
    fiscal = {"start": None, "end": None}
    m = re.search(r"사업연도\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*부터\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*까지", full_text)
    if m:
        fiscal = {"start": f"{m.group(1)}.{int(m.group(2))}.{int(m.group(3))}.", "end": f"{m.group(4)}.{int(m.group(5))}.{int(m.group(6))}."}
    else:
        warn("표지의 사업연도(부터～까지)를 찾지 못했습니다.")

    # 재무상태표·손익계산서
    bs = _find(tables, r"재무상태표|대차대조표", min_rows=8, exclude=r"주석", need=r"자산총계")
    pl = _find(tables, r"손익계산서", min_rows=6, exclude=r"포괄|주석", need=r"당기순")
    finance: dict[str, list[int | None]] = {k: [None, None] for k in ("assets", "liabilities", "equity", "capital", "reserve", "revenue", "net_income")}
    if bs:
        unit = _unit_of(bs.ctx)
        vals = _statement_values(bs, {"assets": r"자산총계", "liabilities": r"부채총계", "equity": r"자본총계", "capital": r"자본금", "reserve": r"손해배상준비금"})
        for k, v in vals.items():
            finance[k] = [_mn(v["cur"], unit), _mn(v["prev"], unit)]
            sources[k] = f"재무상태표 「{k}」"
    else:
        warn("재무상태표를 찾지 못했습니다.")
    if pl:
        unit = _unit_of(pl.ctx)
        vals = _statement_values(pl, {"revenue": r"영업수익|매출액|수익\(매출액\)|매출", "net_income": r"당기순이익|당기순손익|당기순이익\(손실\)|당기순손실\(이익\)|당기순손실"})
        for k, v in vals.items():
            finance[k] = [_mn(v["cur"], unit), _mn(v["prev"], unit)]
            sources[k] = "손익계산서"
    else:
        warn("손익계산서를 찾지 못했습니다.")
    for k, label in (("assets", "총자산"), ("liabilities", "부채"), ("equity", "자기자본"), ("revenue", "매출액"), ("net_income", "당기순이익")):
        if finance[k][0] is None:
            warn(f"{label}(당기)를 읽지 못했습니다.")

    # 손해배상준비금: 재무상태표에 없으면 Ⅴ.1 적립 현황(기말잔액=당기, 기초잔액=전기말)
    if finance["reserve"][0] is None:
        t = _find(tables, r"손해배상준비금.*적립현황|손해배상준비금및손해배상공동기금", min_rows=2)
        if t:
            unit = _unit_of(t.ctx)
            head = t.rows[0]
            idx_end = next((k for k, c in enumerate(head) if "기말" in _squash(c)), None)
            idx_begin = next((k for k, c in enumerate(head) if "기초" in _squash(c)), None)
            for row in t.rows[1:]:
                if _squash(row[0]).startswith("손해배상준비금"):
                    cur = _num(row[idx_end]) if idx_end is not None and idx_end < len(row) else None
                    prev = _num(row[idx_begin]) if idx_begin is not None and idx_begin < len(row) else None
                    finance["reserve"] = [_mn(cur, unit), _mn(prev, unit)]
                    sources["reserve"] = "Ⅴ.1 손해배상준비금 적립 현황(기말잔액·기초잔액)"
                    break
    if finance["reserve"][0] is None:
        warn("손해배상준비금을 읽지 못했습니다.")

    # 사업부문별 매출액
    segments: dict[str, Any] = {k: {"amount": None, "ratio": None} for k in ("audit_ext", "audit_nonext", "audit_sub", "tax", "consulting", "total")}
    seg = _find(tables, r"사업부문별매출", min_rows=3)
    if seg:
        unit = _unit_of(seg.ctx)
        group = ""
        found: dict[str, tuple[Decimal | None, Decimal | None]] = {}
        for row in seg.rows:
            labels, nums = _split_row(row)
            if not labels or not nums:
                continue
            if len(labels) >= 2:
                group, item = labels[0], labels[-1]
            else:
                item = labels[0]
            if _squash(item) in ("합계", "총계"):
                group = ""
            key = (group, item)
            cur = _num(nums[0]) if len(nums) >= 1 else None
            ratio = _num(nums[1]) if len(nums) >= 2 else None
            found[key] = (cur, ratio)
        def pick(pred) -> tuple[Decimal | None, Decimal | None] | None:
            for (g, it), v in found.items():
                if pred(_squash(g), _squash(it)):
                    return v
            return None
        ext = pick(lambda g, it: it.startswith("법정감사") and "외감법" in it and "이외" not in it and "외" != it[-1:] and "외의" not in it)
        nonext = pick(lambda g, it: it.startswith("법정감사") and ("이외" in it or "외의" in it))
        vol = pick(lambda g, it: it.startswith("임의감사"))
        audit_sub = pick(lambda g, it: "회계감사" in g and it in ("소계", "계"))
        tax_sub = pick(lambda g, it: "세무" in g and it in ("소계", "계"))
        total = pick(lambda g, it: it in ("합계", "총계"))
        def put(k: str, v: tuple[Decimal | None, Decimal | None] | None) -> None:
            if v is None:
                return
            segments[k] = {"amount": _mn(v[0], unit), "ratio": float(v[1]) if v[1] is not None else None}
        put("audit_ext", ext)
        if nonext or vol:
            a = (nonext[0] if nonext and nonext[0] is not None else Decimal(0)) + (vol[0] if vol and vol[0] is not None else Decimal(0))
            r = (nonext[1] if nonext and nonext[1] is not None else Decimal(0)) + (vol[1] if vol and vol[1] is not None else Decimal(0))
            segments["audit_nonext"] = {"amount": _mn(a, unit), "ratio": float(r)}
        put("audit_sub", audit_sub)
        put("tax", tax_sub)
        put("total", total)
        if segments["total"]["amount"] is not None and segments["audit_sub"]["amount"] is not None and segments["tax"]["amount"] is not None:
            c = segments["total"]["amount"] - segments["audit_sub"]["amount"] - segments["tax"]["amount"]
            cr = (segments["total"]["ratio"] or 100.0) - (segments["audit_sub"]["ratio"] or 0) - (segments["tax"]["ratio"] or 0)
            segments["consulting"] = {"amount": c, "ratio": round(cr, 2)}
        sources["segments"] = "3. 사업부문별 매출액(당기 금액·비중)"
        if segments["audit_sub"]["amount"] is not None and segments["audit_ext"]["amount"] is not None and segments["audit_nonext"]["amount"] is not None \
                and abs(segments["audit_sub"]["amount"] - segments["audit_ext"]["amount"] - segments["audit_nonext"]["amount"]) > 1:
            warn("부문별 매출: 회계감사 소계가 외감법+비외감 합과 다릅니다(표 모양 확인).")
    else:
        warn("사업부문별 매출액 표를 찾지 못했습니다.")

    # 감사실적 총괄표
    audit_counts: dict[str, dict[str, list[int | None]]] = {b: {"issuer": [None, None], "other": [None, None], "total": [None, None]} for b in ("indi", "con")}
    ac = _find(tables, r"감사실적총괄", min_rows=4)
    if ac:
        block = ""
        issuer_sum: dict[str, list[Decimal]] = {"indi": [Decimal(0), Decimal(0)], "con": [Decimal(0), Decimal(0)]}
        issuer_n: dict[str, int] = {"indi": 0, "con": 0}
        for row in ac.rows:
            labels, nums = _split_row(row)
            if not labels:
                continue
            first = _squash(labels[0])
            if first.startswith("개별") or first.startswith("별도"):
                block = "indi"
            elif first.startswith("연결"):
                block = "con"
            if not block or len(nums) < 2:
                continue
            item = _squash(labels[-1])
            cur, prev = _num(nums[0]), _num(nums[1])
            if item in ("합계", "총계"):
                audit_counts[block]["total"] = [int(cur) if cur is not None else None, int(prev) if prev is not None else None]
            elif item == "기타법인":
                audit_counts[block]["other"] = [int(cur) if cur is not None else None, int(prev) if prev is not None else None]
            elif item == "소계" or "사업보고서제출대상법인" in item and len(labels) >= 2 and _squash(labels[-2]) == "사업보고서제출대상법인" and item == "소계":
                audit_counts[block]["issuer"] = [int(cur) if cur is not None else None, int(prev) if prev is not None else None]
            elif ("상장법인" in item or "사업보고서제출대상" in item) and item != "기타법인":
                issuer_sum[block][0] += cur or 0
                issuer_sum[block][1] += prev or 0
                issuer_n[block] += 1
        for b in ("indi", "con"):
            if audit_counts[b]["issuer"][0] is None and issuer_n[b]:
                audit_counts[b]["issuer"] = [int(issuer_sum[b][0]), int(issuer_sum[b][1])]
            if audit_counts[b]["total"][0] is None and audit_counts[b]["issuer"][0] is not None and audit_counts[b]["other"][0] is not None:
                audit_counts[b]["total"] = [audit_counts[b]["issuer"][0] + audit_counts[b]["other"][0],
                                            (audit_counts[b]["issuer"][1] or 0) + (audit_counts[b]["other"][1] or 0)]
        sources["audit_counts"] = "Ⅱ.2.가 감사실적 총괄표(사업보고서제출대상법인 4종 합 = 발행법인)"
        if audit_counts["indi"]["total"][0] is None:
            warn("감사실적 총괄표에서 개별 합계를 읽지 못했습니다.")
    else:
        warn("감사실적 총괄표를 찾지 못했습니다.")

    # 인력 총괄표 — 마지막 합계 줄: 이사 | 등록 | 수습 | 소계 | 기타직원 | 합계
    staff: dict[str, list[int | None]] = {k: [None, None] for k in ("director", "cpa", "trainee", "cpa_sub", "staff", "total")}
    st = _find(tables, r"인력총괄", min_rows=3)
    if st:
        total_row = None
        for row in st.rows:
            labels, nums = _split_row(row)
            if labels and _squash(labels[-1]) in ("합계", "총계", "계") and len(nums) >= 6:
                total_row = nums
        if total_row:
            vals = [_num(x) for x in total_row[-6:]]
            for k, v in zip(("director", "cpa", "trainee", "cpa_sub", "staff", "total"), vals):
                staff[k] = [int(v) if v is not None else None, None]
            sources["staff"] = "Ⅳ.1 인력 총괄표(마지막 합계 줄)"
        else:
            warn("인력 총괄표의 합계 줄을 찾지 못했습니다.")
    else:
        warn("인력 총괄표를 찾지 못했습니다.")

    # 일반현황
    general: dict[str, Any] = {"ceo": None, "capital_mn": finance["capital"][0], "head_office": None, "branches": None,
                               "founded": None, "alliance": None, "pcaob_date": None, "qc_directors": None, "qc_head": None, "qc_head_source": None}
    ex = _find(tables, r"이사의경력", min_rows=2)
    if ex:
        head = [_squash(c) for c in ex.rows[0]]
        i_name = next((k for k, c in enumerate(head) if c in ("성명", "이름")), 1)
        i_pos = next((k for k, c in enumerate(head) if c in ("직위", "직책")), 2)
        names = [row[i_name].strip() for row in ex.rows[1:] if len(row) > max(i_name, i_pos) and "대표" in _squash(row[i_pos])]
        if names:
            general["ceo"] = ", ".join(dict.fromkeys(n.replace(" ", "") for n in names))
            sources["ceo"] = "Ⅳ.2.가 이사의 경력 현황(직위 대표이사)"
        # 품질관리실장은 사업보고서에 이름이 없다 — 담당업무에 「품질관리」가 든 이사를 「품질관리 담당 이사」로 보여 준다(짐작 아님, 출처 표시)
        i_duty = next((k for k, c in enumerate(head) if c in ("담당업무", "담당", "주요업무")), None)
        if i_duty is not None:
            qcs = [row[i_name].strip().replace(" ", "") for row in ex.rows[1:] if len(row) > max(i_name, i_duty) and "품질관리" in _squash(row[i_duty])]
            if qcs:
                general["qc_directors"] = ", ".join(dict.fromkeys(qcs))
                sources["qc_directors"] = "Ⅳ.2.가 이사의 경력 현황(담당업무에 품질관리)"
    if general["ceo"] is None:
        m = re.search(r"대표이사\s*[:：]\s*([가-힣]{2,4}(?:\s*,\s*[가-힣]{2,4})*)", full_text)
        if m:
            general["ceo"] = m.group(1).replace(" ", "")
            sources["ceo"] = "본문 「대표이사 :」"
        else:
            warn("대표이사를 찾지 못했습니다.")
    # 품질관리실장(사용자 지정 2026-10-08): 보고서에 이름이 명확하면 그 이름, 아니면 표지의 작성책임자 성명, 작성책임자가 대표이사와 같으면 「(확인필)」
    _nm = lambda s: re.sub(r"\s+", "", s or "")
    author = re.search(r"작성\s*책임자\s*[:：]?\s*소속\s*(.*?)\s*직위\s*(.*?)\s*성명\s*([가-힣](?:\s?[가-힣]){1,3})", full_text)
    head_m = re.search(r"품질관리실장\s*(?:성명|[:：])\s*([가-힣](?:\s?[가-힣]){1,3})(?=\s*(?:\(|\d|전화|$))", full_text)
    ceo_names = {_nm(n) for n in (general["ceo"] or "").split(",") if n.strip()}
    if author and "품질관리실장" in _nm(author.group(2)):
        general["qc_head"], general["qc_head_source"] = _nm(author.group(3)), "표지 작성책임자(직위 품질관리실장)"
    elif head_m:
        general["qc_head"], general["qc_head_source"] = _nm(head_m.group(1)), "본문 「품질관리실장」"
    elif author:
        nm = _nm(author.group(3))
        if nm in ceo_names:
            general["qc_head"], general["qc_head_source"] = "(확인필)", f"작성책임자({nm})가 대표이사와 같음"
        else:
            general["qc_head"], general["qc_head_source"] = nm, f"표지 작성책임자(소속 {_nm(author.group(1))} · 직위 {_nm(author.group(2))})"
    else:
        warn("품질관리실장·작성책임자를 찾지 못했습니다.")
    off = _find(tables, r"주사무소및분사무소|사무소현황", min_rows=2)
    if off:
        head = [_squash(c) for c in off.rows[0]]
        i_city = next((k for k, c in enumerate(head) if "소재도시" in c or c == "도시명"), 1)
        i_addr = next((k for k, c in enumerate(head) if c == "주소" or "주소" in c), 2)
        width = len(head)
        head_city = ""
        branches: list[tuple[str, str]] = []   # (도시, 주소)
        for row in off.rows[1:]:
            cells = row if len(row) >= width else [""] + row
            kind = _squash(cells[0])
            city = cells[i_city].strip() if i_city < len(cells) else ""
            addr = cells[i_addr].strip() if i_addr < len(cells) else ""
            if city in ("", "-", "—"):
                continue
            if "주사무소" in kind and general["head_office"] is None:
                general["head_office"] = addr
                head_city = city
            elif "주사무소" not in kind:
                branches.append((city, addr))
        # 같은 도시에 주사무소와 분사무소가 함께 있거나 분사무소가 둘 이상이면 「서울(강남)」처럼 구·동으로 가른다(사용자 지정 2026-10-08)
        from collections import Counter
        cnt = Counter(c for c, _ in branches)
        labels = []
        for city, addr in branches:
            need = cnt[city] > 1 or city == head_city
            labels.append(f"{city}({_district(addr)})" if need and _district(addr) else city)
        general["branches"] = ", ".join(dict.fromkeys(labels)) if labels else "없음"
        sources["offices"] = "I.8 주사무소 및 분사무소 현황"
    else:
        warn("주사무소·분사무소 현황 표를 찾지 못했습니다.")
    m = re.search(r"설립경과[\s\S]{0,400}?(\d{4})\s*[년.]\s*(\d{1,2})\s*[월.]\s*(\d{1,2})", full_text)
    if m:
        general["founded"] = f"{m.group(1)}. {int(m.group(2))}. {int(m.group(3))}."
        sources["founded"] = "I.5.가 설립경과(첫 날짜)"
    else:
        warn("설립일을 찾지 못했습니다(연혁 글).")
    al = _find(tables, r"외국회계법인.*제휴|제휴현황", min_rows=1)
    if al:
        names = []
        for row in al.rows:
            cells = [c.strip() for c in row]
            for k, c in enumerate(cells):
                if _squash(c) in ("회사명", "제휴회사명", "법인명") and k + 1 < len(cells) and cells[k + 1]:
                    names.append(cells[k + 1])
        general["alliance"] = ", ".join(dict.fromkeys(names)) if names else "없음"
        if any("해당사항" in _squash(c) for row in al.rows for c in row):
            general["alliance"] = "없음"
        sources["alliance"] = "I.7 외국 회계법인과의 제휴 현황"
    else:
        general["alliance"] = "없음"
    reg = _find(tables, r"외국회계감독기구등록|회계감독기구등록현황", min_rows=1)
    general["pcaob_date"] = "-"
    if reg:
        head = [_squash(c) for c in reg.rows[0]]
        i_date = next((k for k, c in enumerate(head) if "등록일" in c), None)
        for row in reg.rows[1:]:
            if any("PCAOB" in c.upper() or "상장법인회계감독위원회" in _squash(c) for c in row) and i_date is not None and i_date < len(row):
                general["pcaob_date"] = row[i_date].strip() or "-"
                sources["pcaob"] = "I.9.가 외국 회계감독기구 등록 현황"
                break

    # 확인 필요 memo(사용자 지정 2026-10-08): 부문별 매출 합계는 공시된 대로 두되 영업수익(매출액)과 다르면 바로 알 수 있게
    checks: list[str] = []
    tot, rev = segments["total"]["amount"], finance["revenue"][0]
    if tot is not None and rev is not None and tot != rev and abs(tot - rev) <= 3 and segments["consulting"]["amount"] is not None:
        # 백만원 반올림 단수차이(1~3)는 「컨설팅 등」에서 맞춰 합계 = 영업수익(사용자 지정 2026-10-08)
        segments["consulting"]["amount"] += rev - tot
        segments["total"]["amount"] = rev
        tot = rev
    if tot is not None and rev is not None and tot != rev:
        checks.append(f"부문별매출현황 합계 {tot:,}백만원과 손익계산서 영업수익(매출액) {rev:,}백만원이 다릅니다(차이 {tot - rev:+,}). 사업보고서 공시 내역을 확인하세요.")
    if segments["total"]["ratio"] is not None and abs(segments["total"]["ratio"] - 100) > 0.05:
        checks.append(f"부문별매출현황 비율 합계가 {segments['total']['ratio']}% 입니다(100% 가 아님).")
    if finance["assets"][0] is not None and finance["liabilities"][0] is not None and finance["equity"][0] is not None \
            and finance["assets"][0] - finance["liabilities"][0] != finance["equity"][0]:
        checks.append(f"총자산 − 부채 = {finance['assets'][0] - finance['liabilities'][0]:,} 인데 자기자본은 {finance['equity'][0]:,} 입니다(백만원 반올림 차이일 수 있음).")
    out = {
        "rcept_no": rcept_no, "parser_version": PARSER_VERSION, "term": term, "fiscal": fiscal, "checks": checks,
        "general": general, "audit_counts": audit_counts, "staff": staff, "finance": finance, "segments": segments,
        "external_audit_count": audit_counts["indi"]["total"], "sources": sources, "warnings": warnings,
    }
    return out


# ── 브라우저판 입구(이 파일에만 있음) ─────────────────────────────────────────

def _document_xml(zip_b64: str, rcept_no: str) -> bytes:
    """서버 fetch_document 의 zip 처리 부분과 같다(받기만 Apps Script 가 함)."""
    raw = base64.b64decode(zip_b64)
    if len(raw) > MAX_DOCUMENT:
        raise DartError("원문 파일이 크기 제한(32MB)을 넘습니다.")
    if not raw.startswith(b"PK"):
        try:
            error = etree.fromstring(raw)
            msg = error.findtext("message") or ""
            status = error.findtext("status") or ""
        except etree.XMLSyntaxError:
            raise DartError("공시 원문을 받지 못했습니다.") from None
        raise DartError(f"전자공시({status}): {msg or '원문을 받지 못했습니다.'}")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = [i for i in archive.infolist() if i.filename.lower().endswith(".xml")]
        if sum(i.file_size for i in entries) > MAX_UNPACKED:
            raise DartError("원문 압축 해제 크기가 너무 큽니다.")
        for entry in entries:
            if entry.filename.split("/")[-1].startswith(rcept_no):
                return archive.read(entry)
    raise DartError("원문 zip 안에서 본문 XML 을 찾지 못했습니다.")


def parse_zip(zip_b64: str, rcept_no: str) -> str:
    """document.xml(zip, base64) → parse_firm_report 결과(JSON 글)."""
    return json.dumps(parse_firm_report(_document_xml(zip_b64, rcept_no), rcept_no), ensure_ascii=False)
