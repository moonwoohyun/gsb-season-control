#!/usr/bin/env python3
"""시즌 진행현황 시트(xlsx 내보내기) → 사이트용 시즌별 암호화 데이터.

사용법
  python3 tools/build_data.py --xlsx 진행현황.xlsx --out data --password-file ~/.gsb/site.json
  python3 tools/build_data.py --xlsx 진행현황.xlsx --out data --password '...'   (비추천: 기록에 남음)
  옵션 --plain  : 암호화하지 않은 사본(data_plain/)도 같이 만든다. 확인용, 저장소에 올리지 않는다.

동작
  - 시트의 `보드_{시즌} 신규 / 리오더 / 드랍` 탭을 읽어 시즌별 파일 data/seasons/{시즌}.json 을 만든다.
  - 시트에 없는 시즌(예전 시즌)은 기존 파일을 그대로 둔다. 그래서 시즌이 쌓인다.
  - 모든 파일은 AES-GCM(키: PBKDF2-SHA256, 비밀번호)으로 암호화한다. 사이트는 같은 비밀번호로 연다.
  - 원가·판가는 이 시트에 없고, 넣지도 않는다.
"""
import argparse, base64, datetime as dt, json, os, re, sys
from pathlib import Path

import openpyxl
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ITER = 250_000
CHECK_TEXT = "renacts-ok"
TAB_RE = re.compile(r"^보드_(\d{2}(?:SS|FW))\s*(신규|리오더|드랍)$")
FIELDS = {  # 시트 머리글 → 데이터 키
    "시즌": "season", "구분": "type", "품번": "code", "컬러": "color",
    "아이템명 (영문)": "name", "기획명": "plan", "현재 단계": "stage", "상태": "status",
    "업데이트 날짜": "updated", "최근 내용": "recent", "메모": "memo",
}
DEFAULT_STAGES = ["01_개발진행중", "02_패턴", "03_프로토샘플", "04_QC · 재QC", "05_APP", "06_메인수납", "07_종결", "08_드랍"]
KST = dt.timezone(dt.timedelta(hours=9))


def b64(b): return base64.b64encode(b).decode()
def unb64(s): return base64.b64decode(s)


def derive(password, salt):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode())


def enc(key, obj):
    iv = os.urandom(12)
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    return {"v": 1, "iv": b64(iv), "ct": b64(AESGCM(key).encrypt(iv, data, None))}


def dec(key, box):
    return json.loads(AESGCM(key).decrypt(unb64(box["iv"]), unb64(box["ct"]), None))


def cell(v):
    if v is None: return ""
    if isinstance(v, (dt.datetime, dt.date)): return v.strftime("%Y-%m-%d")
    return str(v).strip()


def season_key(label):
    m = re.match(r"(\d{2})(SS|FW)", label)
    return (int(m.group(1)), 1 if m.group(2) == "FW" else 0) if m else (0, 0)


def read_sheet(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    stages = DEFAULT_STAGES
    if "설정" in wb.sheetnames:
        col = [cell(r[0]) for r in wb["설정"].iter_rows(min_row=2, values_only=True)]
        col = [c for c in col if c]
        if col: stages = col
    seasons = {}
    for ws in wb:
        m = TAB_RE.match(ws.title.strip())
        if not m: continue
        label, tab_type = m.groups()
        rows = list(ws.iter_rows(values_only=True))
        if not rows: continue
        hdr = [cell(h) for h in rows[0]]
        for r in rows[1:]:
            o = {}
            for i, h in enumerate(hdr):
                if h in FIELDS: o[FIELDS[h]] = cell(r[i]) if i < len(r) else ""
            if not (o.get("code") or o.get("plan") or o.get("name")):
                continue  # 빈 줄 · 양식 줄
            o["season"] = o.get("season") or label
            o["type"] = o.get("type") or tab_type
            o["tab"] = tab_type
            if tab_type == "드랍" and not o.get("stage"): o["stage"] = "08_드랍"
            seasons.setdefault(label, []).append(o)
        seasons.setdefault(label, seasons.get(label, []))
    return stages, seasons


def load_password(args):
    if args.password: return args.password
    if args.password_file:
        p = Path(os.path.expanduser(args.password_file))
        j = json.loads(p.read_text(encoding="utf-8"))
        return j["sitePassword"]
    pw = os.environ.get("SITE_PASSWORD")
    if pw: return pw
    sys.exit("비밀번호가 없습니다. --password-file 또는 SITE_PASSWORD 를 주세요.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--out", default="data")
    ap.add_argument("--password"); ap.add_argument("--password-file")
    ap.add_argument("--sheet-url", default="")
    ap.add_argument("--new-password", action="store_true", help="비밀번호를 바꾼다(모든 시즌 파일을 새 비밀번호로 다시 암호화)")
    ap.add_argument("--plain", action="store_true")
    args = ap.parse_args()

    password = load_password(args)
    out = Path(args.out); (out / "seasons").mkdir(parents=True, exist_ok=True)
    man_path = out / "manifest.json"
    old = json.loads(man_path.read_text(encoding="utf-8")) if man_path.exists() else None

    # 이전 시즌 보존을 위해 기존 키로 옛 파일을 풀어 둔다
    keep = {}
    if old:
        old_key = derive(password, unb64(old["kdf"]["salt"])) if not args.new_password else None
        if not args.new_password:
            try:
                assert dec(old_key, old["check"]) == CHECK_TEXT
            except Exception:
                sys.exit("비밀번호가 기존 데이터와 다릅니다. 비밀번호를 바꾸려면 --new-password 로, 옛 비밀번호를 SITE_OLD_PASSWORD 에 넣어 실행하세요.")
        else:
            op = os.environ.get("SITE_OLD_PASSWORD")
            if not op: sys.exit("--new-password 는 SITE_OLD_PASSWORD(옛 비밀번호)가 필요합니다.")
            old_key = derive(op, unb64(old["kdf"]["salt"]))
        for s in old.get("seasons", []):
            f = out / "seasons" / f"{s['label']}.json"
            if f.exists():
                keep[s["label"]] = dec(old_key, json.loads(f.read_text(encoding="utf-8")))

    salt = unb64(old["kdf"]["salt"]) if (old and not args.new_password) else os.urandom(16)
    key = derive(password, salt)

    stages, seasons = read_sheet(args.xlsx)
    now = dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    payloads = dict(keep)
    for label, items in seasons.items():
        payloads[label] = {"label": label, "updated": now, "stages": stages, "sheetUrl": args.sheet_url, "items": items}

    entries = []
    for label in sorted(payloads, key=season_key, reverse=True):
        p = payloads[label]
        (out / "seasons" / f"{label}.json").write_text(json.dumps(enc(key, p), ensure_ascii=False), encoding="utf-8")
        entries.append({"label": label, "file": f"data/seasons/{label}.json", "updated": p["updated"]})
        if args.plain:
            pd = Path("data_plain"); pd.mkdir(exist_ok=True)
            (pd / f"{label}.json").write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding="utf-8")

    manifest = {"v": 1, "updated": now, "kdf": {"name": "PBKDF2-SHA256", "salt": b64(salt), "iter": ITER},
                "check": enc(key, CHECK_TEXT), "seasons": entries}
    man_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    for label in sorted(seasons, key=season_key, reverse=True):
        print(f"{label}: {len(seasons[label])}건 갱신")
    kept = [l for l in keep if l not in seasons]
    if kept: print("유지(시트에 없음):", ", ".join(kept))
    print("완료:", now)


if __name__ == "__main__":
    main()
