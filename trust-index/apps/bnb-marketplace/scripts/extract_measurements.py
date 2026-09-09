"""Preserve only Nibbin endpoint assessments before replacing a discovery snapshot.

No names, categories, owners, provider scores, or feedback leave this extraction.
Conflicting copies and measurements attributed to a different endpoint are omitted.
"""
import argparse
import hashlib
import json
import os
import math
from datetime import datetime
from pathlib import Path


def _mapping(value):
    return value if isinstance(value, dict) else {}


def _dated(value):
    if not isinstance(value, str):
        return False
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo is not None
    except ValueError:
        return False


def _unique_index(payload, key):
    result, conflicts = {}, set()
    for row in _mapping(payload).get('results', []):
        if not isinstance(row, dict):
            continue
        identity = key(row)
        if identity in result and result[identity] != row:
            conflicts.add(identity)
        result[identity] = row
    return {key: value for key, value in result.items() if key not in conflicts}


def _from_probe(endpoint, protocol, probe):
    """Reconstruct discovery facts, never copy a legacy merged number.

    A2A reachability.url names the actual protocol request destination. Discovery
    and declaration URLs are not aliases for that service's measured behavior.
    """
    transcript = _mapping(probe.get(protocol))
    checked = transcript.get('probed_at')
    if not _dated(checked):
        return None
    names, latency, confirmed = [], None, False
    if protocol == 'mcp':
        handshake, tools = _mapping(transcript.get('handshake')), _mapping(transcript.get('tools'))
        # Legacy {ok:true} accepted arbitrary JSON errors. Only the newer parsed
        # initialize transcript with protocol/server identity can be recovered.
        if (transcript.get('endpoint') != endpoint or handshake.get('ok') is not True
                or not isinstance(handshake.get('serverName'), str) or not handshake['serverName'].strip()
                or handshake.get('protocolVersion') not in ('2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25')):
            return None
        confirmed = True
        if tools.get('ok') is True:
            names = [tool['name'] for tool in tools.get('declared', [])
                     if isinstance(tool, dict) and isinstance(tool.get('name'), str)]
        elapsed = [attempt['elapsedMs'] for attempt in transcript.get('attempts', [])
                   if isinstance(attempt, dict) and attempt.get('reachable') is True
                   and isinstance(attempt.get('elapsedMs'), (int, float))]
        latency = elapsed[0] if elapsed else None
        capability_source = 'tools_list' if tools.get('ok') is True else None
    else:
        discovery, declaration = _mapping(transcript.get('discovery')), _mapping(transcript.get('declaration'))
        reachability = _mapping(transcript.get('reachability'))
        if discovery.get('ok') is not True or discovery.get('url') != endpoint or declaration.get('ok') is not True:
            return None  # Host-discovered card cannot stand in for a registered path.
        names = [skill['name'] for skill in declaration.get('skills', [])
                 if isinstance(skill, dict) and isinstance(skill.get('name'), str)]
        service = reachability.get('url')
        interfaces = [interface.get('url') for interface in declaration.get('interfaces', []) if isinstance(interface, dict)]
        confirmed = reachability.get('ok') is True and reachability.get('verdict') == 'speaks_a2a' and isinstance(service, str) and service in interfaces
        if confirmed:
            endpoint, latency = service, reachability.get('elapsedMs')
        else:
            latency = discovery.get('elapsedMs')
        capability_source = 'agent_card'
    value = {'reachable': True, 'protocol_spoken': protocol if confirmed else None,
             'tools_or_skills': names, 'tool_count': len(names), 'latency_ms': latency,
             'coverage': 'thin', 'composite': None,
             'withheld_reason': 'Original scored artifact unavailable for this exact endpoint and protocol; numeric rating withheld.',
             'gates_fired': [], 'checked_at': checked,
             'evidence_state': 'protocol_confirmed' if confirmed else 'card_retrieved',
             'evidence_scope': 'endpoint', 'evidence_endpoint': endpoint,
             'evidence_provenance': 'probe_observation', 'capability_source': capability_source}
    return endpoint, value


def _overlay_score(value, score, require_protocol=True):
    if not score or (require_protocol and value.get('evidence_state') != 'protocol_confirmed'):
        return value
    composite = score.get('composite')
    if composite is not None and (isinstance(composite, bool) or not isinstance(composite, (int, float))
                                  or not math.isfinite(composite) or not 0 <= composite <= 100):
        return value
    result = dict(value)
    result['composite'] = composite
    result['withheld_reason'] = score.get('withheld_reason') if composite is None else None
    result['gates_fired'] = [gate.get('gate_id', str(gate)) if isinstance(gate, dict) else str(gate)
                            for gate in score.get('gates_fired', [])]
    breadth = score.get('dimension_coverage')
    breadth = 'strong' if isinstance(breadth, (int, float)) and breadth >= .85 else 'moderate' if isinstance(breadth, (int, float)) and breadth >= .6 else 'thin'
    depth = score.get('evidence_tier')
    order = ['thin', 'moderate', 'strong']
    result['coverage'] = order[min(order.index(breadth), order.index(depth) if depth in order else 0)]
    return result


def extract(dataset, probes=None, scored=None):
    measurements, conflicts = {}, set()
    probe_index = _unique_index(probes, lambda row: row.get('endpoint'))
    scores = _unique_index(scored, lambda row: (row.get('endpoint'), row.get('protocol')))
    for row in dataset.get('agents', []):
        assessment = row.get('assessment')
        endpoint = row.get('endpoint')
        if row.get('is_reference_agent') or not isinstance(assessment, dict) or not isinstance(endpoint, str):
            continue
        protocol = assessment.get('protocol_spoken')
        if protocol not in ('mcp', 'a2a'):
            continue
        if probes is not None:
            proven = _from_probe(endpoint, protocol, probe_index.get(endpoint, {}))
            if proven is None:
                continue
            endpoint, value = proven
            value = _overlay_score(value, scores.get((endpoint, protocol)))
        else:
            if (assessment.get('evidence_endpoint') != endpoint or assessment.get('evidence_scope') != 'endpoint'
                    or assessment.get('evidence_provenance') != 'probe_observation'):
                continue
            value = {key: val for key, val in assessment.items() if key not in ('endpoint_shared_with', 'shared_registration_count')}
        key = (endpoint, protocol)
        if key in measurements and measurements[key] != value:
            conflicts.add(key)
        measurements[key] = value
    return [{'endpoint': endpoint, 'protocol': protocol, 'assessment': value}
            for (endpoint, protocol), value in sorted(measurements.items()) if (endpoint, protocol) not in conflicts]


def _a2a_message_response(call):
    result = _mapping(call.get('result'))
    return (_mapping(call.get('request')).get('method') == 'message/send'
            and isinstance(call.get('httpStatus'), int) and 200 <= call['httpStatus'] < 300
            and not call.get('transportError') and not call.get('jsonRpcError')
            and ((result.get('kind') == 'message' and isinstance(result.get('parts'), list))
                 or (result.get('kind') == 'task' and isinstance(result.get('status'), dict))))


def recover_original(scored, transcripts, mcp_battery, a2a_battery, source_hashes=None):
    """Recover published subjects directly, without the legacy candidate pool.

    This is an attribution join, NOT another scoring pass. Batteries establish
    which interface was exercised. A returned A2A error message can establish a
    protocol response but does not establish successful capability execution.
    """
    if not _dated(scored.get('as_of')) or not _dated(scored.get('generated_at')):
        raise ValueError('Original score as_of and generated_at must be explicit dated instants')
    hashes = source_hashes or {}
    scores = _unique_index(scored, lambda row: (row.get('endpoint'), row.get('protocol')))
    a2a_index = _unique_index(a2a_battery, lambda row: row.get('endpoint'))
    readings, links, excluded = [], [], []
    for (endpoint, protocol), score in sorted(scores.items()):
        if score.get('composite') is None:
            continue  # Engine-withheld rows remain in the immutable source artifact.
        if protocol not in ('mcp', 'a2a') or not isinstance(endpoint, str):
            excluded.append({'endpoint': endpoint, 'protocol': protocol, 'reason': 'invalid score subject'})
            continue
        matches = []
        for name, source in transcripts.items():
            transcript = source['transcript']
            if not name.startswith(protocol + '_'):
                continue
            if protocol == 'mcp':
                matched = transcript.get('endpoint') == endpoint
            else:
                matched = any(_mapping(interface).get('url') == endpoint
                              for interface in _mapping(transcript.get('declaration')).get('interfaces', []))
            if matched:
                matches.append((name, source))
        if len(matches) != 1:
            excluded.append({'endpoint': endpoint, 'protocol': protocol, 'reason': 'missing or ambiguous original transcript'})
            continue
        name, source = matches[0]
        transcript = source['transcript']
        declared = endpoint if protocol == 'mcp' else _mapping(transcript.get('discovery')).get('url')
        proven = _from_probe(declared, protocol, {protocol: transcript})
        if proven is None:
            excluded.append({'endpoint': endpoint, 'protocol': protocol, 'reason': 'unproven original protocol declaration'})
            continue
        _, value = proven
        battery_times, calls, valid_battery = [], [], False
        if protocol == 'mcp':
            battery = [row for row in mcp_battery if row.get('endpoint') == endpoint]
            declared_tools = {_mapping(tool).get('name') for tool in _mapping(transcript.get('tools')).get('declared', [])}
            valid_battery = len(battery) == score.get('battery_outcomes') and bool(battery)
            for row in battery:
                observations = row.get('observations', [])
                row_calls = row.get('calls', [])
                valid_battery = valid_battery and (row.get('server') == Path(name).stem
                    and row.get('tool') in declared_tools and bool(row_calls)
                    and all(_mapping(call.get('result')).get('tool') == row.get('tool') for call in row_calls)
                    and all(observation.get('evidence_ref', '').split('#')[0] == endpoint
                            and observation.get('provenance') in ('measured', 'judged')
                            and _dated(observation.get('ts')) for observation in observations))
                battery_times.extend(observation['ts'] for observation in observations if _dated(observation.get('ts')))
                calls.extend(row_calls)
        else:
            battery = a2a_index.get(endpoint, {})
            skills = battery.get('skills', [])
            declared_skills = {_mapping(skill).get('id') for skill in _mapping(transcript.get('declaration')).get('skills', [])}
            calls = [call for skill in skills for call in skill.get('calls', [])]
            valid_battery = (len(skills) == score.get('battery_outcomes') and bool(skills)
                             and all(skill.get('skillId') in declared_skills for skill in skills)
                             and _dated(battery.get('probedAt')) and bool(calls)
                             and all(_mapping(call.get('request')).get('method') == 'message/send' for call in calls)
                             and any(isinstance(call.get('result'), dict) and call.get('httpStatus') == 200
                                     and not call.get('transportError') and not call.get('jsonRpcError') for call in calls))
            if _dated(battery.get('probedAt')):
                battery_times.append(battery['probedAt'])
            # Later message/send is the evidence here, even when the earlier
            # tasks/get or GetTask returned method-not-found (for example SMEAI).
            if valid_battery:
                confirmed = any(_a2a_message_response(call) for call in calls)
                value.update(protocol_spoken='a2a' if confirmed else None,
                             evidence_state='protocol_confirmed' if confirmed else 'response_received', evidence_endpoint=endpoint)
                successful = next(call for call in calls if isinstance(call.get('result'), dict))
                value['latency_ms'] = successful.get('elapsedMs')
        if not valid_battery:
            excluded.append({'endpoint': endpoint, 'protocol': protocol, 'reason': 'missing, conflicting, or unlinked original battery'})
            continue
        value = _overlay_score(value, score, require_protocol=False)
        if value.get('composite') != score.get('composite'):
            excluded.append({'endpoint': endpoint, 'protocol': protocol, 'reason': 'invalid published score'})
            continue
        observed = sorted(set(battery_times), key=lambda time: datetime.fromisoformat(time.replace('Z', '+00:00')))
        value['checked_at'] = max([transcript['probed_at'], *observed], key=lambda time: datetime.fromisoformat(time.replace('Z', '+00:00')))
        provenance = {'score_as_of': scored['as_of'], 'scored_generated_at': scored['generated_at'],
                      'probe_observed_at': transcript['probed_at'], 'battery_observed_at': observed,
                      'transcript_file': name, 'transcript_sha256': source['sha256'],
                      'battery_sha256': hashes.get('source_' + protocol + '_battery_sha256'),
                      'battery_outcomes': score['battery_outcomes'],
                      'protocol_confirmation_basis': ('message_send_response' if value['evidence_state'] == 'protocol_confirmed'
                                                      else 'nonstandard_message_send_result') if protocol == 'a2a' else 'initialize_response',
                      'capability_success_claimed': False}
        readings.append({'endpoint': endpoint, 'protocol': protocol, 'assessment': value,
                         'provenance': provenance,
                         'original_score': {key: score.get(key) for key in ('composite_low', 'composite_high', 'dimension_coverage', 'assessment_completeness', 'evidence_tier', 'harness_gaps')}})
        if protocol == 'a2a' and declared.rstrip('/') != endpoint.rstrip('/'):
            links.append({'protocol': 'a2a', 'declared_endpoint': declared,
                          'measured_endpoint': endpoint, 'transcript_sha256': source['sha256']})
    published = [row for row in scored.get('results', []) if row.get('composite') is not None]
    return {**hashes, 'score_as_of': scored['as_of'], 'scored_generated_at': scored['generated_at'],
            'attribution_policy': 'Original published scores copied without rescoring. Exact protocol/endpoint joins across score, transcript and battery. A2A declaration links are explicit, never endpoint identity aliases. Protocol response does not establish successful capability execution.',
            'clock_note': 'The original 02:00 scoring parameter precedes the actual observations. It is not the time measured, publication time, or a historical availability claim.',
            'summary': {'original_subjects': len(scored.get('results', [])), 'original_published': len(published),
                        'recovered_published': len(readings), 'excluded': excluded},
            'assessments': readings, 'interface_links': links}


def load_original_evidence(directory):
    directory = Path(directory)
    inputs, hashes = {}, {}
    for name, key in [('scored-endpoints.json', 'scored'), ('mcp-battery.json', 'mcp_battery'), ('a2a-battery.json', 'a2a_battery')]:
        raw = (directory / name).read_bytes()
        inputs[key] = json.loads(raw)
        hashes['source_' + key + '_sha256'] = hashlib.sha256(raw).hexdigest()
    transcripts = {}
    for path in sorted((directory / 'transcripts').glob('*.json')):
        raw = path.read_bytes()
        transcripts[path.name] = {'transcript': json.loads(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    manifest = [{'file': name, 'sha256': source['sha256']} for name, source in transcripts.items()]
    hashes['source_transcripts_manifest_sha256'] = hashlib.sha256(json.dumps(manifest, separators=(',', ':')).encode()).hexdigest()
    return recover_original(inputs['scored'], transcripts, inputs['mcp_battery'], inputs['a2a_battery'], hashes)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input')
    parser.add_argument('--out', required=True)
    parser.add_argument('--probes', help='Original collector transcripts, not an already merged listing snapshot')
    parser.add_argument('--scored', help='Original scorer results with explicit endpoint and protocol; no aliases')
    parser.add_argument('--original-evidence', help='Recover all published subjects from an original scorer/batteries/transcripts directory')
    args = parser.parse_args()
    if args.original_evidence:
        if args.input or args.probes or args.scored:
            parser.error('--original-evidence cannot be combined with legacy snapshot inputs')
        output = load_original_evidence(args.original_evidence)
    else:
        if not args.input:
            parser.error('--input or --original-evidence is required')
        source = Path(args.input).read_bytes()
        probe_source = Path(args.probes).read_bytes() if args.probes else None
        score_source = Path(args.scored).read_bytes() if args.scored else None
        output = {'source_snapshot_sha256': hashlib.sha256(source).hexdigest(),
              'source_probes_sha256': hashlib.sha256(probe_source).hexdigest() if probe_source else None,
              'source_scored_sha256': hashlib.sha256(score_source).hexdigest() if score_source else None,
              'attribution_policy': 'Exact measured endpoint and protocol only; no card/service aliases. Legacy numeric scores require the original scored artifact.',
              'assessments': extract(json.loads(source), probes=json.loads(probe_source) if probe_source else None,
                                     scored=json.loads(score_source) if score_source else None)}
    target = Path(args.out)
    if target.exists():
        raise SystemExit('Refusing to overwrite an existing measurement artifact')
    temporary = target.with_suffix(target.suffix + '.tmp')
    temporary.write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, target)
    print(f"Preserved {len(output['assessments'])} endpoint/protocol assessments; no registration metadata.")
