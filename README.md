# Kitchen Safety — Kev yes/no questions

A small test of [Kev](https://github.com/jaredpalmer/kev) (Jev-style decision model, Kev-0.8B, served locally on Apple Silicon via MLX) answering 20 yes/no kitchen-safety questions over short scenario texts, via the TypeSafe System One SDK (`Noul` questions, one forward pass each).

## Run it

```bash
git clone https://github.com/jaredpalmer/kev && cd kev
uv sync --extra serve
uv run --extra serve python -m kev.serve --run jaredpalmer/kev-0.8b --port 8009
uv run python kitchen_test.py   # from this repo
```

## Results

| Question | Careful cook | Risky cook | Ambiguous |
|---|---|---|---|
| Handles turned inward | 0.93 | 0.39 | 0.23 |
| Dry oven mitts | 0.36 | 0.26 | 0.14 |
| Stove off when unused | 0.54 | 0.37 | 0.29 |
| Flammables away from burners | 0.49 | 0.30 | 0.23 |
| Stable cutting board | 0.92 | 0.18 | 0.35 |
| Knives stored, not in sink | 0.42 | 0.10 | 0.34 |
| Cutting away from body | 0.84 | 0.38 | 0.15 |
| Lid/baking soda in reach | 0.51 | 0.33 | 0.17 |
| Staying in kitchen while cooking | 0.91 | 0.77 | 0.57 |
| Clothing/hair tied back | 0.73 | 0.85 | 0.18 |
| Smoke detector working | 0.39 | 0.40 | 0.34 |
| Hands washed | 0.95 | 0.24 | 0.62 |
| Raw meat separate | 0.41 | 0.41 | 0.53 |
| Separate board for raw meat | 0.29 | 0.38 | 0.27 |
| Leftovers refrigerated ≤2h | 0.63 | 0.50 | 0.60 |
| Spills wiped right away | 0.93 | 0.23 | 0.44 |
| Cords away from water/heat | 0.43 | 0.36 | 0.37 |
| Kids/pets out of cooking area | 0.33 | 0.24 | 0.28 |
| Floor dry, no trip hazards | 0.36 | 0.16 | 0.38 |
| Knows extinguisher location | 0.34 | 0.39 | 0.27 |

## Findings

- Strong on explicitly stated facts (handles inward 0.93, hands washed 0.95 / 0.24).
- Misses implied violations: "staying" scored 0.77 for a cook who walked away; "clothing_tied" 0.85 despite loose sleeves.
- Unmentioned items land ~0.15–0.55 — low resolution between "absent" and "violated".
- Third-person phrasing ("Is the cook staying…") likely better than second person; a bigger model (4B+) would likely fix the inference misses.
