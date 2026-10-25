"""Kev playground backend: proxies /v1/systemone, batches >12 questions."""

import asyncio
import os
import pathlib
import re
from typing import Optional

import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

PLAYGROUND = pathlib.Path(__file__).resolve().parent
STATIC = PLAYGROUND / "static"
SITE = PLAYGROUND.parent / "site"
MAX_QUESTIONS_PER_REQUEST = 12


def _dotenv_key():
    env = PLAYGROUND / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "KEV_API_KEY" and value.strip():
                return value.strip()
    return None


DEFAULT_KEY = _dotenv_key() or os.environ.get("KEV_API_KEY")

app = FastAPI()
app.mount("/static", StaticFiles(directory=STATIC), name="static")


class AskRequest(BaseModel):
    base_url: str
    model: str
    api_key: Optional[str] = None
    state: str
    questions: dict


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


@app.get("/core.js")
@app.get("/site/core.js")
async def core_js():
    return FileResponse(SITE / "core.js", media_type="text/javascript")


@app.get("/tools.json")
async def tools_json():
    return FileResponse(SITE / "tools.json", media_type="application/json")


@app.post("/api/ask")
async def ask(req: AskRequest):
    base = req.base_url.rstrip("/")
    headers = {"content-type": "application/json"}
    key = req.api_key or (DEFAULT_KEY if "modal.run" in base else None)
    if key:
        headers["authorization"] = f"Bearer {key}"

    names = list(req.questions)
    answers: dict = {}
    usage = {"input_tokens": 0, "output_tokens": 0}
    latency_ms = 0.0

    async with httpx.AsyncClient(timeout=300) as http:
        for i in range(0, len(names), MAX_QUESTIONS_PER_REQUEST):
            chunk = {n: req.questions[n] for n in names[i : i + MAX_QUESTIONS_PER_REQUEST]}
            try:
                r = await http.post(
                    f"{base}/v1/systemone",
                    json={"state": req.state, "model": req.model, "questions": chunk},
                    headers=headers,
                )
            except httpx.HTTPError as e:
                return JSONResponse({"error": f"request to {base} failed: {e}"}, status_code=502)
            if r.status_code != 200:
                return JSONResponse(
                    {"error": f"{r.status_code} from {base}: {r.text[:500]}"}, status_code=502
                )
            data = r.json()
            answers.update(data.get("answers", {}))
            u = data.get("usage") or {}
            usage["input_tokens"] += u.get("input_tokens", 0)
            usage["output_tokens"] += u.get("output_tokens", 0)
            latency_ms += data.get("latency_ms") or 0

    return {"answers": answers, "usage": usage, "latency_ms": latency_ms}


STOPWORDS = {
    "i", "am", "a", "an", "the", "on", "in", "to", "for", "of", "and", "or", "with",
    "from", "by", "want", "look", "looking", "at", "their", "my", "we", "are", "is",
    "be", "been", "working", "scientist", "research", "study", "studying", "find",
    "finding", "predict", "predicting", "model", "models", "tool", "tools", "best",
    "use", "using", "how", "what", "which", "where", "data", "analysis", "task",
    "need", "needs", "sequence", "sequences", "structure", "structures", "gene",
    "genes", "protein", "proteins", "explore", "exploring", "investigate",
    "responsible", "associated", "involved", "related", "cause", "causing", "that",
    "this", "those", "these", "can", "could", "would", "should", "about", "into",
    "across", "between", "affect", "affecting", "control", "controlling", "determine",
}

UK_TO_US = {
    "colour": "color", "colours": "colors", "haemoglobin": "hemoglobin",
    "tumour": "tumor", "tumours": "tumors", "oesophagus": "esophagus",
    "leukaemia": "leukemia", "anaemia": "anemia", "foetal": "fetal",
    "oestrogen": "estrogen", "behaviour": "behavior", "signalling": "signaling",
}


def extract_query(text: str) -> str:
    cleaned = text
    for uk, us in UK_TO_US.items():
        cleaned = re.sub(rf"\b{uk}\b", us, cleaned, flags=re.I)
    cleaned = re.sub(r"\be\.?\s*coli\b", "Escherichia coli", cleaned, flags=re.I)
    cleaned = re.sub(r"\bs\.?\s*cerevisiae\b", "Saccharomyces cerevisiae", cleaned, flags=re.I)
    cleaned = re.sub(r"\bs\.?\s*aureus\b", "Staphylococcus aureus", cleaned, flags=re.I)
    cleaned = re.sub(r"\bb\.?\s*subtilis\b", "Bacillus subtilis", cleaned, flags=re.I)
    cleaned = re.sub(r"\bp\.?\s*aeruginosa\b", "Pseudomonas aeruginosa", cleaned, flags=re.I)
    words = [w for w in re.findall(r"[A-Za-z0-9_.-]+", cleaned) if w.lower() not in STOPWORDS and len(w) > 1]
    return " ".join(words[:5]) or text.strip()[:60]


class ResourceSearchRequest(BaseModel):
    text: str


@app.post("/api/search_resources")
async def search_resources(req: ResourceSearchRequest):
    q = extract_query(req.text)
    items: list[dict] = []

    async with httpx.AsyncClient(timeout=12, follow_redirects=True) as http:
        async def uniprot():
            r = await http.get(
                "https://rest.uniprot.org/uniprotkb/search",
                params={"query": f"({q}) AND (reviewed:true)", "size": "3", "format": "json"},
            )
            for res in (r.json().get("results") or [])[:3]:
                acc = res.get("primaryAccession", "")
                name = (
                    res.get("proteinDescription", {})
                    .get("recommendedName", {})
                    .get("fullName", {})
                    .get("value", "")
                )
                org = res.get("organism", {}).get("scientificName", "")
                genes = [g.get("geneName", {}).get("value", "") for g in res.get("genes", [])]
                gstr = genes[0] if genes and genes[0] else ""
                items.append({
                    "source": "UniProt / AlphaFold DB",
                    "id": acc,
                    "title": f"{name or acc} ({gstr}) — {org}".strip(" —()"),
                    "url": f"https://www.uniprot.org/uniprotkb/{acc}",
                    "af_url": f"https://alphafold.ebi.ac.uk/entry/{acc}",
                    "summary": f"UniProt {acc}: {name} in {org} (gene {gstr}); precomputed AlphaFold structure at AF-{acc}-F1.",
                })

        async def rcsb():
            body = {
                "query": {"type": "terminal", "service": "full_text", "parameters": {"value": q}},
                "return_type": "entry",
                "request_options": {"paginate": {"start": 0, "rows": 3}},
            }
            r = await http.post("https://search.rcsb.org/rcsbsearch/v2/query", json=body)
            if r.status_code != 200:
                return
            for hit in (r.json().get("result_set") or [])[:3]:
                pdb_id = hit.get("identifier", "")
                if not pdb_id:
                    continue
                s = await http.get(f"https://data.rcsb.org/rest/v1/core/entry/{pdb_id}")
                title = (s.json().get("struct", {}).get("title", "") if s.status_code == 200 else "") or pdb_id
                items.append({
                    "source": "RCSB PDB",
                    "id": pdb_id,
                    "title": f"PDB {pdb_id}: {title[:90]}",
                    "url": f"https://www.rcsb.org/structure/{pdb_id}",
                    "summary": f"Experimental 3D structure PDB {pdb_id}: {title}",
                })

        async def ncbi_gene():
            es = await http.get(
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
                params={"db": "gene", "term": q, "retmax": "4", "retmode": "json", "sort": "relevance"},
            )
            ids = es.json().get("esearchresult", {}).get("idlist", [])
            if not ids:
                return
            sm = await http.get(
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
                params={"db": "gene", "id": ",".join(ids), "retmode": "json"},
            )
            res = sm.json().get("result", {})
            for gid in ids:
                g = res.get(gid) or {}
                sym = g.get("name", gid)
                desc = g.get("description", "")
                org = (g.get("organism") or {}).get("scientificname", "")
                summ = (g.get("summary") or "")[:240]
                items.append({
                    "source": "NCBI Gene",
                    "id": gid,
                    "title": f"{sym} — {desc} ({org})",
                    "url": f"https://www.ncbi.nlm.nih.gov/gene/{gid}",
                    "summary": f"NCBI Gene {gid} ({sym}): {desc} in {org}. {summ}".strip(),
                })

        async def ncbi_assembly():
            es = await http.get(
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
                params={"db": "assembly", "term": f"{q} AND latest_refseq[filter]", "retmax": "2", "retmode": "json"},
            )
            ids = es.json().get("esearchresult", {}).get("idlist", [])
            if not ids:
                return
            sm = await http.get(
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
                params={"db": "assembly", "id": ",".join(ids), "retmode": "json"},
            )
            res = sm.json().get("result", {})
            for aid in ids:
                a = res.get(aid) or {}
                acc = a.get("assemblyaccession", aid)
                org = a.get("speciesname", "")
                aname = a.get("assemblyname", "")
                items.append({
                    "source": "NCBI RefSeq Assembly",
                    "id": acc,
                    "title": f"{acc} ({aname}) — {org}",
                    "url": f"https://www.ncbi.nlm.nih.gov/datasets/genome/{acc}/",
                    "summary": f"NCBI RefSeq reference genome assembly {acc} ({aname}) for {org}.",
                })

        await asyncio.gather(uniprot(), rcsb(), ncbi_gene(), ncbi_assembly(), return_exceptions=True)

    return {"query": q, "items": items}
