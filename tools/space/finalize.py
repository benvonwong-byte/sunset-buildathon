"""Drop chains from the storefront records; merge website-scraped hours.

  python3 finalize.py S prep     -> work/records.nochain.json + work/scrape_in.json
  python3 finalize.py S merge    -> work/records.final.json   (uses dl/sites/scraped.json)
  python3 finalize.py S export DEST_DIR  -> DEST_DIR/spaces.json (OpenStreetMap places only) and basemap.json
"""
import json
import os
import re
import subprocess
import sys

S, mode = sys.argv[1:3]

# National chains, plus Bay Area chains with roughly 10+ stores. Matched against the whole name.
CHAIN_NAMES = r"""
7-?eleven | 76 | sam truong's 76 | sunset 76 | arco( food mart)? | chevron | shell( service center)? | valero
| chevo food max.* | royal gas | alliance | olympian
| bank of america | chase | citibank | wells fargo | u\.?s\.? bank | east west bank | cathay bank | first bank
| ever ?bank | industrial and commercial bank of china | bank of the orient | patelco credit union | sf police credit union
| allstate | farmers insurance | state farm | carol yee insurance agency | eric swanson | american automobile association
| block advisors | h&r block | coldwell banker | intero.* | re/max.* | white cap
| chipotle | domino's | kfc.* | taco bell | wingstop | noah's bagels | peet's coffee | starbucks | quickly
| krispy krunchy.* | ono hawaiian bbq | mixt | crepevine | pacific catch | yi fang tea
| gymboree | kumon | mathnasium.* | tutoring club | the joint chiropractic | hearusa | physiotherapy associates
| petco | ross | big 5 sporting goods | sherwin-williams | fedex office | the ups store
| verizon | cricket wireless | total wireless | o'reilly auto parts | va[v]?oline.*
| walgreens | cvs.* | lucky | safeway | carbon health | one medical.*
"""
CHAIN_RE = re.compile(r"^(?:" + "".join(CHAIN_NAMES.split("\n")).replace(" | ", "|").replace("| ", "|").strip() + r")$", re.I)
DROP_TYPES = {"bank", "fuel"}


def is_chain(r):
    return r["t"] in DROP_TYPES or bool(CHAIN_RE.match(r["n"].strip()))


recs = json.load(open(f"{S}/work/records.json"))
keep = [r for r in recs if not is_chain(r)]
for r in keep:
    r.pop("chain", None)

if mode == "prep":
    dropped = [r for r in recs if is_chain(r)]
    print(f"records {len(recs)} -> {len(keep)} after dropping {len(dropped)} chain / bank / gas-station records")
    print("dropped:", " | ".join(sorted({r['n'] for r in dropped}, key=str.lower)))
    json.dump(keep, open(f"{S}/work/records.nochain.json", "w"), separators=(",", ":"), ensure_ascii=False)
    todo = [{"id": r["id"], "name": r["n"], "url": r["web"]} for r in keep if "w" not in r and r.get("web", "").startswith("http")]
    json.dump(todo, open(f"{S}/work/scrape_in.json", "w"), indent=1, ensure_ascii=False)
    print("hourless with a website, to scrape:", len(todo), "| hourless total:", sum(1 for r in keep if "w" not in r))

elif mode == "merge":
    scraped = json.load(open(f"{S}/dl/sites/scraped.json"))
    if os.path.exists(f"{S}/dl/sites/scraped2.json"):  # rerun after the robots.txt matcher fix wins
        scraped.update(json.load(open(f"{S}/dl/sites/scraped2.json")))
    items = [{"id": i, "oh": v["oh"]} for i, v in scraped.items() if v.get("status") == "hours"]
    json.dump(items, open(f"{S}/work/hours_in2.json", "w"))
    subprocess.run(["node", os.path.join(os.path.dirname(os.path.abspath(__file__)), "eval_hours.js"), f"{S}/work/hours_in2.json", f"{S}/work/hours_out2.json"], check=True)
    ev = json.load(open(f"{S}/work/hours_out2.json"))
    n = 0
    for r in keep:
        v = scraped.get(r["id"])
        if "w" in r:
            r["hs"] = "osm"
        elif v and v.get("status") == "hours" and ev.get(r["id"], {}).get("week"):
            e = ev[r["id"]]
            r["oh"], r["w"], r["hs"], r["hurl"] = e["pretty"], e["week"], "site", v["url"]
            n += 1
    json.dump(keep, open(f"{S}/work/records.final.json", "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"merged website hours into {n} records; {sum(1 for r in keep if 'w' in r)} of {len(keep)} now have hours")

elif mode == "export":
    # Public copy: places that appear only in the city registry are left out, since a
    # registration can name a person at a home address.
    dest = sys.argv[3]
    final = json.load(open(f"{S}/work/records.final.json"))
    pub = [r for r in final if not r["id"].startswith("reg/")]
    json.dump(pub, open(os.path.join(dest, "spaces.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    json.dump(json.load(open(f"{S}/work/basemap.json")), open(os.path.join(dest, "basemap.json"), "w"), separators=(",", ":"))
    print(f"wrote {len(pub)} places to {dest}")
