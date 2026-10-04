# Preview Experiment Architecture

Gitai_Lab Preview is organized around three independent experiment axes.

## 1. Environment

An Environment describes where individuals are displayed. It contains only habitat/display information:

- environment_id
- display name
- background image
- source dimensions
- forbidden placement areas

It must not contain target colors, target patterns, or any instruction telling evolution how to resemble the background.

Folder convention:

```text
environments/<environment_id>/environment.json
```

The Preview URL accepts `?env=<environment_id>`. Legacy aliases remain supported:

- no env / `env=bark` -> `bark_001`
- `env=sand` -> `sand_001`

A future environment such as fried rice can therefore be added as a new folder without changing evolution rules.

## 2. Evolution Model

An Evolution Model defines heredity, mutation, and phenotype generation. It must not read or analyze the background.

Folder convention:

```text
data/evolution_models/<model_id>/config.json
```

The Preview URL accepts `?model=<model_id>`.

### continuous_v1

The existing SOLO v22 behavior is frozen as:

- model_id: `continuous_v1`
- config: `data/evolution_models/continuous_v1/config.json`
- inheritance: `trait_procedural_genotype_v2`

The old `data/evo_config/evo_config_v2.json` is retained as historical v22 material and is not deleted.

A second model (planned: `morph_v1`) will be implemented independently rather than replacing Continuous v1.

## 3. Run

A Run is one independent evolutionary history.

The Preview URL accepts:

```text
?run=<run_id>
```

Default is `run=default`.

Storage identity is conceptually:

```text
Environment × Evolution Model × Run
```

This lets the same habitat/model combination be repeated independently, and lets different models use the same habitat without overwriting each other.

For current public testers, the legacy bark/sand + Continuous v1 + default run keeps using the existing IndexedDB names so current generations are not lost.

New combinations use a v3 namespaced IndexedDB.

## Founder set

Continuous v1 declares:

- founder_set_id: `standard_white_001`
- deterministic founder seed: `gitailab-standard-white-001`

When a new Continuous v1 run starts, Generation 1 is reproducible from that seed. The seed does not depend on Environment, so bark, sand, and future backgrounds can start from the same Generation 1 genotype population.

This is intended to make background comparisons interpretable.

A future model may use a different genome schema, but should map the shared founder-set concept to an equivalent initial phenotype/population when cross-model comparison is desired.

## Diagnostic logs

Diagnostic export includes:

- Environment identity
- Evolution Model identity
- Run identity
- founder_set_id
- evolution config identity
- selection results
- selected parents
- pairing plan
- child traits
- mutation events

This allows later analysis of whether a phenotype failed to arise, arose but was eaten, or arose and failed to establish.

## Design invariant

Evolution models must not inspect the habitat image to decide mutation direction.

The direction of adaptation comes from the player's predation decisions:

```text
random/heritable variation
        ↓
human visual predation
        ↓
differential survival/reproduction
        ↓
population change
```

This invariant applies equally to biologically natural backgrounds and playful backgrounds such as fried rice.
