# Lessons

- When a workflow author supplies a provider-specific model reference as one string, preserve that exact string in workflow YAML. Do not reinterpret or split it into provider-internal routing fields unless the user explicitly requests that transformation. Let the selected provider own model-reference handling; use the E2E result to expose any provider contract defect.
- Do not infer that a missing provider API-key environment variable means the upstream harness is unauthenticated. Check subscription/OAuth/token-plan login state first. A provider adapter must not reject before launching an upstream harness that owns a valid ambient login flow.
- Before hard-coding an E2E model reference, confirm the exact requested model variant. If the user corrects it, rename the workflow and file too so test identity cannot drift from the model under test.
