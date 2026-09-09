import unittest
import json
import copy
from pathlib import Path
from extract_measurements import extract, load_original_evidence, recover_original


class MeasurementExtraction(unittest.TestCase):
    def test_drops_registration_and_provider_data(self):
        assessment = {'protocol_spoken': 'mcp', 'composite': 70, 'endpoint_shared_with': 229,
                      'evidence_endpoint': 'https://service.example/mcp', 'evidence_scope': 'endpoint',
                      'evidence_provenance': 'probe_observation'}
        row = {'name': 'Provider metadata', 'endpoint': 'https://service.example/mcp',
               'scan_total_score': 99, 'assessment': assessment}
        result = extract({'agents': [row, row]})
        self.assertEqual(result, [{'endpoint': row['endpoint'], 'protocol': 'mcp',
                                  'assessment': {key: value for key, value in assessment.items()
                                                 if key != 'endpoint_shared_with'}}])

    def test_different_endpoint_and_conflicting_scores_are_not_transferred(self):
        row = {'endpoint': 'https://service.example/mcp', 'assessment': {'protocol_spoken': 'mcp', 'composite': 70,
               'evidence_endpoint': 'https://service.example/mcp', 'evidence_scope': 'endpoint',
               'evidence_provenance': 'probe_observation'}}
        changed = {**row, 'assessment': {**row['assessment'], 'composite': 80}}
        self.assertEqual(extract({'agents': [row, changed]}), [])
        mismatch = {**row, 'assessment': {**row['assessment'], 'evidence_endpoint': 'https://other.example/mcp'}}
        self.assertEqual(extract({'agents': [mismatch, {**row, 'is_reference_agent': True}]}), [])

    def test_listing_endpoint_is_not_measurement_provenance(self):
        row = {'endpoint': 'https://service.example/mcp',
               'assessment': {'protocol_spoken': 'mcp', 'composite': 70}}
        self.assertEqual(extract({'agents': [row]}), [])

    def test_a2a_score_belongs_to_service_not_card_url(self):
        card, service = 'https://service.example/.well-known/agent-card.json', 'https://service.example/a2a'
        dataset = {'agents': [{'endpoint': card, 'assessment': {'protocol_spoken': 'a2a', 'composite': 99}}]}
        probes = {'results': [{'endpoint': card, 'a2a': {
            'subject_url': card, 'probed_at': '2026-09-09T09:40:27Z',
            'discovery': {'ok': True, 'url': card},
            'declaration': {'ok': True, 'interfaces': [{'url': service}], 'skills': [{'name': 'Report'}]},
            'reachability': {'ok': True, 'url': service, 'verdict': 'speaks_a2a', 'elapsedMs': 570}}}]}
        scores = {'results': [{'endpoint': service, 'protocol': 'a2a', 'composite': 77.5,
                              'dimension_coverage': 1, 'evidence_tier': 'thin', 'gates_fired': []}]}
        result = extract(dataset, probes=probes, scored=scores)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['endpoint'], service)
        self.assertEqual(result[0]['assessment']['evidence_endpoint'], service)
        self.assertEqual(result[0]['assessment']['composite'], 77.5)
        self.assertEqual(result[0]['assessment']['coverage'], 'thin')
        self.assertEqual(result[0]['assessment']['latency_ms'], 570)
        missing_score = extract(dataset, probes=probes)[0]['assessment']
        self.assertIsNone(missing_score['composite'])
        self.assertIn('unavailable', missing_score['withheld_reason'])
        scores['results'][0]['protocol'] = 'mcp'
        self.assertIsNone(extract(dataset, probes=probes, scored=scores)[0]['assessment']['composite'])

    def test_card_discovery_does_not_prove_protocol_or_inherit_a_score(self):
        card = 'https://service.example/.well-known/agent-card.json'
        dataset = {'agents': [{'endpoint': card, 'assessment': {'protocol_spoken': 'a2a', 'composite': 77}}]}
        probes = {'results': [{'endpoint': card, 'a2a': {
            'subject_url': card, 'probed_at': '2026-09-09T09:40:27Z',
            'discovery': {'ok': True, 'url': card}, 'declaration': {'ok': True, 'skills': []},
            'reachability': {'ok': False, 'url': 'https://service.example/a2a'}}}]}
        result = extract(dataset, probes=probes)
        self.assertEqual(result[0]['assessment']['evidence_state'], 'card_retrieved')
        self.assertIsNone(result[0]['assessment']['protocol_spoken'])
        self.assertIsNone(result[0]['assessment']['composite'])

    def test_unvalidated_legacy_mcp_handshake_and_host_discovery_are_excluded(self):
        endpoint = 'https://service.example/image.jpg'
        dataset = {'agents': [{'endpoint': endpoint, 'assessment': {'protocol_spoken': 'mcp', 'composite': 70}}]}
        probes = {'results': [{'endpoint': endpoint, 'mcp': {'endpoint': endpoint,
                   'probed_at': '2026-09-09T09:40:27Z', 'handshake': {'ok': True}}}]}
        self.assertEqual(extract(dataset, probes=probes), [])
        dataset['agents'][0]['assessment']['protocol_spoken'] = 'a2a'
        probes['results'][0]['a2a'] = {'discovery': {'ok': True, 'url': 'https://service.example/.well-known/agent-card.json'},
                                      'declaration': {'ok': True}}
        self.assertEqual(extract(dataset, probes=probes), [])

    def test_saved_artifact_has_explicit_attribution_and_no_untraceable_numbers(self):
        path = Path(__file__).parents[1] / 'data/probes/independent-assessments-2026-09-09.json'
        artifact = json.loads(path.read_text(encoding='utf-8'))
        self.assertIsNotNone(artifact.get('source_probes_sha256'))
        for record in artifact['assessments']:
            assessment = record['assessment']
            self.assertEqual(assessment['evidence_endpoint'], record['endpoint'])
            self.assertEqual(assessment['evidence_scope'], 'endpoint')
            if not artifact.get('source_scored_sha256'):
                self.assertIsNone(assessment['composite'])
            if assessment['evidence_state'] == 'card_retrieved':
                self.assertIsNone(assessment['protocol_spoken'])
                self.assertIsNone(assessment['composite'])


class OriginalEvidenceRecovery(unittest.TestCase):
    def fixture(self):
        service, card = 'https://agent.example/a2a', 'https://agent.example/card.json'
        scored = {'as_of': '2026-09-09T02:00:00Z', 'generated_at': '2026-09-09T10:46:12.869Z',
                  'results': [{'endpoint': service, 'protocol': 'a2a', 'composite': 65.06,
                               'composite_low': 40, 'composite_high': 80, 'dimension_coverage': 1,
                               'evidence_tier': 'thin', 'battery_outcomes': 1, 'gates_fired': []}]}
        transcript = {'subject_url': card, 'probed_at': '2026-09-09T09:27:06Z',
                      'discovery': {'ok': True, 'url': card},
                      'declaration': {'ok': True, 'interfaces': [{'url': service}], 'skills': [{'id': 'health', 'name': 'Health'}]},
                      'reachability': {'ok': True, 'url': service, 'verdict': 'jsonrpc_no_a2a_method'}}
        transcripts = {'a2a_agent.json': {'transcript': transcript, 'sha256': 'a' * 64}}
        battery = {'results': [{'endpoint': service, 'probedAt': '2026-09-09T10:34:59.855Z', 'skills': [
            {'skillId': 'health', 'calls': [{'request': {'method': 'message/send'}, 'httpStatus': 200,
             'result': {'kind': 'message', 'role': 'agent', 'parts': [{'kind': 'text', 'text': 'Reply'}]}, 'elapsedMs': 80}]}]}]}
        return scored, transcripts, [], battery

    def test_recovers_failed_discovery_with_later_exact_message_battery_and_distinct_clocks(self):
        args = self.fixture()
        artifact = recover_original(*args)
        self.assertEqual(len(artifact['assessments']), 1)
        result = artifact['assessments'][0]
        self.assertEqual(result['endpoint'], 'https://agent.example/a2a')
        self.assertEqual(result['assessment']['composite'], 65.06)
        self.assertEqual(result['assessment']['checked_at'], '2026-09-09T10:34:59.855Z')
        self.assertEqual(result['provenance']['score_as_of'], '2026-09-09T02:00:00Z')
        self.assertEqual(result['assessment']['evidence_state'], 'protocol_confirmed')
        self.assertEqual(artifact['interface_links'], [{'protocol': 'a2a', 'declared_endpoint': 'https://agent.example/card.json',
                          'measured_endpoint': 'https://agent.example/a2a', 'transcript_sha256': 'a' * 64}])

    def test_missing_battery_wrong_protocol_conflicting_score_and_unlinked_service_fail_closed(self):
        scored, transcripts, mcp, a2a = self.fixture()
        self.assertEqual(recover_original(scored, transcripts, mcp, {'results': []})['assessments'], [])
        wrong = copy.deepcopy(scored)
        wrong['results'][0]['protocol'] = 'mcp'
        self.assertEqual(recover_original(wrong, transcripts, mcp, a2a)['assessments'], [])
        conflict = copy.deepcopy(scored)
        conflict['results'].append({**conflict['results'][0], 'composite': 99})
        self.assertEqual(recover_original(conflict, transcripts, mcp, a2a)['assessments'], [])
        transcripts['a2a_agent.json']['transcript']['declaration']['interfaces'][0]['url'] = 'https://other.example/a2a'
        self.assertEqual(recover_original(scored, transcripts, mcp, a2a)['assessments'], [])

    def test_original_run_recovers_all_42_exact_published_values_without_legacy_candidates(self):
        directory = Path(__file__).parents[3] / 'packages/collectors/evidence/2026-09-09'
        artifact = load_original_evidence(directory)
        original = json.loads((directory / 'scored-endpoints.json').read_text(encoding='utf-8'))
        expected = {(row['endpoint'], row['protocol']): row['composite'] for row in original['results'] if row['composite'] is not None}
        actual = {(row['endpoint'], row['protocol']): row['assessment']['composite'] for row in artifact['assessments']}
        self.assertEqual(len(expected), 42)
        self.assertEqual(actual, expected)
        self.assertEqual(sum(protocol == 'mcp' for _, protocol in actual), 13)
        self.assertEqual(sum(protocol == 'a2a' for _, protocol in actual), 29)
        self.assertEqual(actual[('https://smeai-dev.vercel.app/api/a2a', 'a2a')], 65.06)
        for row in artifact['assessments']:
            self.assertEqual(row['assessment']['evidence_endpoint'], row['endpoint'])
            self.assertGreater(row['assessment']['checked_at'], row['provenance']['score_as_of'])
            self.assertNotIn('calls', row)
        self.assertEqual(len(artifact['source_scored_sha256']), 64)
