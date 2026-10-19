#!/usr/bin/env python3
"""Unit tests asserting deterministic execution of agent_governance_eval.py."""

import json
import os
import sys
import unittest

# Ensure the eval directory is on sys.path regardless of execution CWD
_EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
if _EVAL_DIR not in sys.path:
    sys.path.insert(0, _EVAL_DIR)

from agent_governance_eval import evaluate_corpus, EXPECTED_RATES, CORPUS


class TestAgentGovernanceEval(unittest.TestCase):
    def test_corpus_size_and_structure(self):
        self.assertEqual(len(CORPUS), 11, "Corpus should contain exactly 11 scenarios")
        for sc in CORPUS:
            self.assertTrue(bool(sc.name), "Scenario must have a name")
            self.assertIn(sc.klass, {"crude", "residual", "benign"}, "Class must be known")
            self.assertIsInstance(sc.label_block, bool, "label_block must be boolean")
            self.assertTrue(len(sc.spends) >= 1, "Scenario must have at least 1 spend")

    def test_evaluation_matches_committed_fixture(self):
        summary = evaluate_corpus()
        self.assertEqual(summary["cases"], EXPECTED_RATES["cases"])
        self.assertEqual(summary["cap_only"], EXPECTED_RATES["cap_only"])
        self.assertEqual(summary["cap_plus_drift"], EXPECTED_RATES["cap_plus_drift"])
        self.assertEqual(summary["win"], EXPECTED_RATES["win"])

    def test_fixture_json_consistency(self):
        fixture_path = os.path.join(os.path.dirname(__file__), "expected_governance_eval.json")
        with open(fixture_path, "r", encoding="utf-8") as f:
            fixture = json.load(f)

        summary = evaluate_corpus()
        self.assertEqual(summary["cases"], fixture["cases"])
        self.assertEqual(summary["cap_only"]["tpr_all"], fixture["cap_only"]["tpr_all"])
        self.assertEqual(summary["cap_only"]["fpr"], fixture["cap_only"]["fpr"])
        self.assertEqual(summary["cap_only"]["tpr_residual"], fixture["cap_only"]["tpr_residual"])
        self.assertEqual(summary["cap_plus_drift"]["tpr_all"], fixture["cap_plus_drift"]["tpr_all"])
        self.assertEqual(summary["cap_plus_drift"]["fpr"], fixture["cap_plus_drift"]["fpr"])
        self.assertEqual(summary["cap_plus_drift"]["tpr_residual"], fixture["cap_plus_drift"]["tpr_residual"])
        self.assertEqual(summary["win"], fixture["win"])


if __name__ == "__main__":
    unittest.main()
