# Pet pack fixtures

`valid-sprite` and `valid-rive` contain manifests accepted by the v1 JSON Schema. The `invalid-*.json` files must be rejected by the schema check.

`archive-cases.json` is a declarative source for the Rust archive tests in PET-02. Those tests generate ZIP entries at runtime so the repository does not store malicious or oversized archives.
