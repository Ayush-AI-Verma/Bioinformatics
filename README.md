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

## Backend

The default endpoint is <https://ayush-ai-verma--kev27b-api.modal.run>, serving Kev-27B on Modal with B200, H200, or H100 GPUs. It costs about $6.25/hour while warm and scales to zero after five idle minutes. Cold start is about one minute; the first-ever start can take several minutes.

Enter an API key in the **Settings** tab. The key is stored only in your browser's `localStorage` and is never committed.

To deploy your own endpoint, use [`deploy/kev_serve.py`](deploy/kev_serve.py): Kev's Modal deploy script plus an outer CORS layer, which browsers need to call a key-protected endpoint:

```bash
KEV_MODEL=jaredpalmer/kev-27b KEV_APP_NAME=kev27b KEV_API_KEY=$(openssl rand -hex 24) modal deploy deploy/kev_serve.py
```

Any System One endpoint works. To run Kev locally:

```bash
uv run --extra serve python -m kev.serve --run jaredpalmer/kev-0.8b --port 8009
```

Then set the endpoint to `http://localhost:8009`.

## Run locally

```bash
cd site && python3 -m http.server 8080
```

## Tests

Run `npm test` with Node 22 or newer; no dependencies are required. It runs core unit tests, mock-server client tests, and catalog validation. GitHub Actions runs the suite on every push and pull request via [`.github/workflows/test.yml`](.github/workflows/test.yml).

## Example

See the [kitchen-safety example](examples/kitchen-safety/).
