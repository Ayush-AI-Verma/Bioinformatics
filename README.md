# Bioinformatics Tool Finder

Describe your bioinformatics task and the data you have; Kev (https://github.com/jaredpalmer/kev) ranks tools from a curated catalog of 299 tools across 20 categories: Sequence QC & trimming, Read alignment, Long-read sequencing, Genome assembly, Variant calling, Population genetics & GWAS, RNA-seq quantification & differential expression, Single-cell analysis, Epigenomics (ChIP/ATAC/methylation), Metagenomics & microbiome, Sequence search & multiple alignment, Genome annotation, Phylogenetics & evolution, Protein structure prediction & analysis, Molecular docking & virtual screening, Cheminformatics, Proteomics & mass spectrometry, File formats & utilities, Visualization & genome browsers, and Workflow managers.

## How it works

1. Kev asks a System One `choice` question across the 20 categories. It selects the highest-probability categories until their cumulative probability reaches 0.8, or it has selected three categories.
2. Kev asks one `choice` question per selected category, with each tool's name, description, inputs, and outputs as the option text. Each tool score is `P(category) × P(tool | category)`, and the top 10 tools are shown.

The **Browse catalog** tab lets you search the catalog and filter by category.

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

## Example

See the [kitchen-safety example](examples/kitchen-safety/).
