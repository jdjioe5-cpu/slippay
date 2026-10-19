# SlipPay Quantitative Evaluation Harnesses

This directory holds the quantitative evaluation benchmarks and assertions verifying SlipPay's core architectural claims.

---

## 1. Code-Prove vs. LLM-Judge Benchmark (`prove_vs_judge_benchmark.mjs`)

Measures the deterministic code-proven predicate evaluation speed and accuracy against decidable money invariants.

- **Deterministic Code-Prove**:
  - Zero model tokens, zero external API calls, exact integer arithmetic and membership evaluation.
  - Test battery: 11 boundary cases across amount limits, exact equality, 7-decimal currency fractions, and allowlist checking.
  - Target: **100% (11/11) accuracy** asserted deterministically.
- **Historical LLM-Judge Column**:
  - **Single Recorded Run**: Generated on 2026-05-07 via workflow `w10t6ixln` (40/40 correct, ~thousands of tokens, ~seconds latency).
  - Explicitly **not bundled for offline reproduction** as it requires paid API keys and external model calls.
- **Run Benchmark**:
  ```bash
  node eval/prove_vs_judge_benchmark.mjs
  ```
- **Run Assertion Test**:
  ```bash
  node --test eval/prove_vs_judge_benchmark.test.mjs
  # Or via npm script:
  pnpm run eval:prove:test
  ```

---

## 2. Agent Governance Evaluation (`agent_governance_eval.py`)

Falsifiable smoke-test measuring whether the AXL/SSL-bound drift detector beats conventional cap-only wallets (e.g. Coinbase AgentKit, Crossmint) on residual adversarial spend without false-positive inflation on benign traffic.

- **Corpus**:
  - 11 scenarios across crude adversarial (`over_per_tx`, `disallowed_recipient`, `blows_window_cap`), residual adversarial (`structuring_micro`, `treasury_drain_conservation`, `collusion_rare_counterparty`), and benign business payments (`normal_payout`, `large_but_capped_payout`, `legit_supplier_payment`, `month_end_burst`, `near_window_within_inflow`).
- **Committed Target Metrics (`expected_governance_eval.json`)**:
  - Conventional `cap_only`:
    - Overall TPR: `0.50`
    - Residual TPR: `0.00` (structurally blind to residual attacks)
    - Benign FPR: `0.00`
  - AXL `cap_plus_drift`:
    - Overall TPR: `1.00`
    - Residual TPR: `1.00`
    - Benign FPR: `0.00`
  - **Verdict**: AXL WINS (`win: true`), satisfying the kill condition (`TPR_residual >= 0.90` at `FPR <= 0.05`).
- **Install Dependencies**:
  ```bash
  pip install -r eval/requirements.txt
  ```
- **Run Evaluation**:
  ```bash
  python eval/agent_governance_eval.py
  # Automated check matching committed fixture:
  python eval/agent_governance_eval.py --assert
  ```
- **Run Unit Tests**:
  ```bash
  python -m unittest eval/test_agent_governance_eval.py
  # Or via pytest:
  pytest eval/test_agent_governance_eval.py
  ```

---

## 3. CI Invocations

Both deterministic benchmarks are integrated into the root GitHub Actions workflow (`.github/workflows/test.yml`) to prevent regression on any PR or merge:
- `node --test eval/prove_vs_judge_benchmark.test.mjs`
- `python eval/agent_governance_eval.py --assert`
- `python -m unittest eval/test_agent_governance_eval.py`
