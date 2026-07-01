# Text2Component fixtures (G0)

Hand-authored pairs for parallel FE/AI development. `component_spec` is metadata only;
`dataset` is what `formatData(spec, rows)` produces.

| Pair | Chart type |
|------|------------|
| `component_spec.bar.json` + `dataset.bar.json` | bar |
| `component_spec.line.json` + `dataset.line.json` | line |
| `component_spec.row.json` + `dataset.row.json` | row |
| `component_spec.pie.json` + `dataset.pie.json` | pie |
| `component_spec.value.json` + `dataset.value.json` | value |
| `component_spec.table.json` + `dataset.table.json` | table |

Edge: `rows.empty.json` — raw SQL rows with zero data (for formatter tests).
