# Bioinformatics Tool Finder

Describe your bioinformatics task and the data you have; Kev (https://github.com/jaredpalmer/kev) ranks tools from a curated catalog of 317 tools across 21 categories: Sequence QC & trimming, Read alignment, Long-read sequencing, Genome assembly, Variant calling, Population genetics & GWAS, RNA-seq quantification & differential expression, Single-cell analysis, Epigenomics (ChIP/ATAC/methylation), Metagenomics & microbiome, Sequence search & multiple alignment, Genome annotation, Natural products & metabolomics, Phylogenetics & evolution, Protein structure prediction & analysis, Molecular docking & virtual screening, Cheminformatics, Proteomics & mass spectrometry, File formats & utilities, Visualization & genome browsers, and Workflow managers.

## How it works

**Single task.** Describe one task to get ranked tools, scored by `P(category) × P(tool | category)`.

**Pipeline.** For a multi-step analysis, Kev answers one yes/no question per category to select up to six steps in typical workflow order. It ranks the top three tools for each step and shows format hand-off hints.

**Browse and refine.** Search the catalog and filter by category, input or output format, license (including open-source only), language, and install method. Copy a tool's install command.

**Share, save, and compare.** Shareable links such as `#q=…&mode=pipeline` rerun the search when opened. Favorites and recent searches are stored in the browser. Compare up to three tools side by side.

**Reliability.** Requests have timeouts and automatic retries with backoff for cold starts, 5xx, 429, and network errors. A cancel button and elapsed-time status are provided. Settings can test the connection through `/v1/models`; endpoint and mixed-content validation and a 10–4000 character input limit are built in. If Kev is unreachable or the key is wrong, keyword search provides a fallback.

## Catalog

The catalog is [`site/tools.json`](site/tools.json), with fields `id`, `name`, `category`, `description`, `inputs`, `outputs`, `language`, `license`, `install`, and `url`. Every URL was checked live. Pull requests are welcome.

## Run it locally

```bash
git clone https://github.com/Ayush-AI-Verma/Bioinformatics.git && cd Bioinformatics && python3 serve.py
```

If `KEV_API_KEY` is not already set in the environment or `.env`, startup prompts for it with hidden input and asks whether to save it in `.env` for next time. The file is gitignored and saved with owner-only permissions. The local server adds the key to requests to Kev; the browser never receives the server-side key.

The default endpoint is <https://ayush-ai-verma--kev27b-api.modal.run>, serving Kev-27B on Modal with B200, H200, or H100 GPUs. It costs about $6.25/hour while warm and scales to zero after five idle minutes. After idle, the cold start is about one minute; the first-ever start can take several minutes.

The server binds to `127.0.0.1` on port 8000 by default. If that port is busy, it tries ports 8001 through 8010. Choose a port or suppress browser launch with:

```bash
python3 serve.py --port 8080 --no-browser
```

Set `KEV_ENDPOINT` in the environment or `.env` to your Kev-9B endpoint to use that model instead. The same setting can point to any System One endpoint.

## Tests

Run `npm test` with Node 22 or newer; no dependencies are required. It runs core unit tests, mock-server client tests, and catalog validation. GitHub Actions runs the suite on every push and pull request via [`.github/workflows/test.yml`](.github/workflows/test.yml).

## Example

See the [kitchen-safety example](examples/kitchen-safety/).
