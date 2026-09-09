#!/usr/bin/env python3
"""Offline BSC registration importer. No 8004scan reads, network, or import-time writes.

--current JSON: {records:[{agent_id:'56:123' or '123', token_uri, block,
                         owner?, metadata?, metadata_source?, error?}]}. An attempted current read
that failed cannot fall back to historical metadata. Missing records remain
explicitly historical. Supplied metadata must belong to that record's token_uri.
An RPC URI/owner observation does not establish cached remote content freshness;
only inline metadata returned within that URI inherits the RPC block.
--assessments JSON: {assessments:[{endpoint, protocol:'mcp'|'a2a', assessment:{...}}]}.
Only independently measured artifacts belong here; no registration metadata is
ever interpreted as an assessment. Optional interface_links records explicitly
link A2A declared_endpoint to measured_endpoint with transcript_sha256. No
inferred endpoint aliases or host-level joins; direct exact matches win.
--resolved gzip NDJSON: {uri,name,machine:[{type,url}],fetch_error?,http_status?}.
--metadata gzip NDJSON: {uri,doc}. Both join by EXACT URI, not resolver agent ID.
Output is deterministic for identical inputs and --as-of, written atomically.
"""
import argparse
import base64
import binascii
from collections import Counter
from datetime import datetime
import gzip
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import unquote, unquote_to_bytes, urlsplit, urlunsplit

from build_dataset import categorise  # Pure taxonomy only; its main is guarded.

MAX_METADATA_BYTES = 262144
MAX_FRAME_LINE = 1048576
IDENTITY_REGISTRY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432'
ADDRESS = re.compile(r'0x[0-9a-fA-F]{40}\Z')
BLOCKED_HOSTS = {'localhost', 'github.com', 'raw.githubusercontent.com', 'gitlab.com',
                 'twitter.com', 'x.com', 't.me', 'telegram.me', 'discord.com', 'discord.gg',
                 'linkedin.com', 'facebook.com', 'youtube.com', 'example.com', 'example.org',
                 '8004scan.io', '8004scan.com', '8004scan.app'}
ASSESSMENT_FIELDS = {'reachable', 'protocol_spoken', 'tools_or_skills', 'tool_count',
                     'latency_ms', 'coverage', 'composite', 'withheld_reason', 'gates_fired',
                     'checked_at', 'evidence_state', 'evidence_scope', 'evidence_endpoint',
                     'evidence_provenance', 'capability_source', 'evidence_source'}
CONFLICT = object()
PROVENANCE_FIELDS = {'score_as_of', 'scored_generated_at', 'probe_observed_at',
                     'battery_observed_at', 'transcript_sha256', 'battery_sha256'}


def fetch_failed(record):
    return bool(record.get('fetch_error')) or isinstance(record.get('http_status'), int) and record['http_status'] >= 400


def strict_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate JSON key')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('non-finite JSON')))


def json_bytes(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def decode_inline(value):
    """Accept only bounded JSON data URIs; no eval, remote retrieval or decompression."""
    if not isinstance(value, str) or len(value) > MAX_METADATA_BYTES * 4 or not value.startswith('data:'):
        return None
    try:
        header, encoded = value.split(',', 1)
        parts = header[5:].lower().split(';')
        if parts[0] not in ('application/json', 'application/ld+json'):
            return None
        if any(part not in ('base64', 'charset=utf-8', 'charset=utf8') for part in parts[1:]):
            return None
        if re.search(r'%(?![0-9a-fA-F]{2})', encoded):
            return None
        raw = unquote_to_bytes(encoded)
        if 'base64' in parts:
            raw = base64.b64decode(raw, validate=True)
        if len(raw) > MAX_METADATA_BYTES:
            return None
        return strict_json(raw.decode('utf-8'))
    except (ValueError, UnicodeError, binascii.Error, RecursionError):
        return None


def normalized_endpoint(value):
    """Conservative string identity, NOT a DNS vetting or reachability claim."""
    if not isinstance(value, str) or not value or len(value) > 4096:
        return None
    if re.search(r'[\x00-\x20\x7f\\{}<>]', value) or re.search(r'[{}<>]', unquote(value)):
        return None
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or '').lower()
        if parsed.scheme.lower() not in ('https', 'http') or not host or parsed.username or parsed.password or parsed.fragment:
            return None
        if host.endswith('.') or '.' not in host or any(host == bad or host.endswith('.' + bad) for bad in BLOCKED_HOSTS):
            return None
        if host.endswith(('.local', '.localhost', '.internal', '.invalid', '.test', '.example')):
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            # Ambiguous numeric IPv4 forms and non-DNS characters are not public names.
            if re.fullmatch(r'[0-9.]+', host) or not re.fullmatch(r'[a-z0-9.-]+', host):
                return None
            if any(not label or label.startswith('-') or label.endswith('-') for label in host.split('.')):
                return None
        port = parsed.port
        authority = host if port is None or (parsed.scheme.lower(), port) in (('https', 443), ('http', 80)) else f'{host}:{port}'
        return urlunsplit((parsed.scheme.lower(), authority, parsed.path or '/', parsed.query, ''))
    except ValueError:
        return None


def third_party_uri(value):
    if not isinstance(value, str):
        return False
    try:
        host = (urlsplit(value).hostname or '').lower().rstrip('.')
        return any(host == domain or host.endswith('.' + domain) for domain in ('8004scan.io', '8004scan.com', '8004scan.app'))
    except ValueError:
        return False


def uri_index(records, document=False):
    if records is None:
        return {}
    if isinstance(records, dict):
        records = records.get('documents' if document else 'records')
    if not isinstance(records, list):
        raise ValueError('URI input must be a list of records')
    result = {}
    for entry in records:
        if not isinstance(entry, dict) or not isinstance(entry.get('uri'), str):
            raise ValueError('URI record must contain an exact uri string')
        key = entry['uri']
        # Resolver output may repeat a URI for registrations sharing it. Their
        # event owners/IDs do not alter the metadata document identity.
        value = entry.get('doc') if document else {name: entry.get(name) for name in ('name', 'machine', 'fetch_error', 'http_status', 'x402')}
        if key in result:
            previous = result[key]
            if previous is CONFLICT:
                continue
            if previous == value:
                continue
            if not document:
                if fetch_failed(previous) and not fetch_failed(value):
                    result[key] = value
                    continue
                if not fetch_failed(previous) and fetch_failed(value):
                    continue
                if fetch_failed(previous) and fetch_failed(value):
                    result[key] = min((previous, value), key=json_bytes)
                    continue
            result[key] = CONFLICT
            continue
        result[key] = value
    return result


def services(metadata):
    raw = metadata.get('services', metadata.get('service', []))
    result = []
    if isinstance(raw, list):
        result.extend((str(item.get('name', item.get('type', ''))).lower(), item) for item in raw if isinstance(item, dict))
    elif isinstance(raw, dict):
        for name, item in raw.items():
            if isinstance(item, dict):
                result.append((name.lower(), item))
            elif isinstance(item, list):
                result.extend((name.lower(), entry) for entry in item if isinstance(entry, dict))
    for name in ('mcp', 'a2a'):
        if isinstance(metadata.get(name), dict):
            result.append((name, metadata[name]))
    return result


def declared_interfaces(metadata):
    found = set()
    for protocol, declaration in services(metadata):
        if protocol not in ('mcp', 'a2a') or str(declaration.get('transport', '')).lower() in ('stdio', 'local'):
            continue
        endpoint = normalized_endpoint(declaration.get('endpoint', declaration.get('url')))
        if endpoint:
            found.add((protocol, endpoint))
    return [{'protocol': protocol, 'endpoint': endpoint} for protocol, endpoint in
            sorted(found, key=lambda pair: (pair[0] != 'mcp', pair[1]))]


def valid_metadata(value):
    if not isinstance(value, dict) or not isinstance(value.get('name'), str) or not value['name'].strip() or len(value['name']) > 512:
        return False
    if 'description' in value and (not isinstance(value['description'], str) or len(value['description']) > 20000):
        return False
    try:
        return len(json_bytes(value)) <= MAX_METADATA_BYTES
    except (ValueError, TypeError, RecursionError):
        return False


def token_id(value):
    if not isinstance(value, str):
        raise ValueError('agent_id must be a decimal string')
    value = value.removeprefix('56:')
    if not re.fullmatch(r'0|[1-9][0-9]{0,77}', value) or int(value) >= 2 ** 256:
        raise ValueError('invalid BSC agent id')
    return value


def block_number(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def current_index(payload):
    if payload is None:
        return {}
    if not isinstance(payload, dict) or not isinstance(payload.get('records'), list):
        raise ValueError('current input needs records[]')
    result = {}
    for record in payload['records']:
        if not isinstance(record, dict) or record.get('chain_id', 56) != 56:
            raise ValueError('current record must belong to BSC')
        identifier = token_id(record.get('agent_id'))
        if identifier in result:
            raise ValueError('duplicate current record')
        result[identifier] = record
    return result


def assessment_index(payload):
    if payload is None:
        return {}
    if not isinstance(payload, dict) or not isinstance(payload.get('assessments'), list):
        raise ValueError('assessment input needs assessments[]')
    result = {}
    for entry in payload['assessments']:
        if not isinstance(entry, dict):
            raise ValueError('assessment entry must be an object')
        endpoint = normalized_endpoint(entry.get('endpoint'))
        protocol, assessment = entry.get('protocol'), entry.get('assessment')
        if not endpoint or protocol not in ('mcp', 'a2a') or not isinstance(assessment, dict):
            raise ValueError('assessment requires a public endpoint and explicit protocol')
        if assessment.get('protocol_spoken') not in (None, protocol):
            raise ValueError('assessment protocol mismatch')
        if assessment.get('evidence_endpoint') and normalized_endpoint(assessment['evidence_endpoint']) != endpoint:
            raise ValueError('assessment evidence endpoint mismatch')
        if assessment.get('evidence_scope') == 'host':
            raise ValueError('host observations cannot establish an endpoint assessment')
        score = assessment.get('composite')
        if score is not None and (isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 100):
            raise ValueError('invalid composite')
        if assessment.get('coverage') not in ('thin', 'moderate', 'strong') or not isinstance(assessment.get('checked_at'), str):
            raise ValueError('assessment requires dated coverage')
        datetime.fromisoformat(assessment['checked_at'].replace('Z', '+00:00'))
        key = (protocol, endpoint)
        if key in result:
            raise ValueError('duplicate assessment endpoint/protocol; resolve chronology upstream')
        result[key] = {key: value for key, value in assessment.items() if key in ASSESSMENT_FIELDS}
        result[key]['evidence_endpoint'] = endpoint
        if 'provenance' in entry:
            if not isinstance(entry['provenance'], dict):
                raise ValueError('assessment provenance must be an object')
            result[key]['provenance'] = {name: value for name, value in entry['provenance'].items()
                                         if name in PROVENANCE_FIELDS}
    return result


def interface_link_index(payload, measured):
    """Validate recorded, single-hop A2A links; never derive links from a host."""
    entries = payload.get('interface_links', []) if payload is not None else []
    if not isinstance(entries, list):
        raise ValueError('interface_links must be a list')
    result = {}
    for entry in entries:
        if not isinstance(entry, dict) or entry.get('protocol') != 'a2a':
            raise ValueError('interface link requires explicit a2a protocol')
        declared = normalized_endpoint(entry.get('declared_endpoint'))
        endpoint = normalized_endpoint(entry.get('measured_endpoint'))
        digest = entry.get('transcript_sha256')
        if not declared or not endpoint or declared == endpoint or not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest):
            raise ValueError('invalid recorded interface link')
        key, target = ('a2a', declared), ('a2a', endpoint)
        if target not in measured:
            raise ValueError('interface link requires an exact measured endpoint/protocol')
        value = (target, digest)
        if key in result and result[key] != value:
            raise ValueError('conflicting interface links; resolve ambiguity upstream')
        result[key] = value
    return result


def resolve_assessment(interface, measured, links):
    key = (interface['protocol'], interface['endpoint'])
    if key in measured:
        return key, measured[key]
    if key in links:
        target, digest = links[key]
        return target, {**measured[target], 'evidence_declared_endpoint': key[1],
                        'evidence_link_sha256': digest}
    return key, None


def build_dataset(frame_path, current=None, assessments=None, as_of=None, resolved=None, metadata=None):
    if as_of is not None:
        datetime.fromisoformat(as_of.replace('Z', '+00:00'))
    current_by_id, measured = current_index(current), assessment_index(assessments)
    links = interface_link_index(assessments, measured)
    resolved_by_uri, metadata_by_uri = uri_index(resolved), uri_index(metadata, document=True)
    metadata_input_hash = hashlib.sha256(json_bytes(metadata)).hexdigest() if metadata is not None else None
    frame_path = Path(frame_path)
    digest = hashlib.sha256(frame_path.read_bytes()).hexdigest()
    seen, agents, outcomes = set(), [], Counter()
    blocks, current_blocks = [], []
    with gzip.open(frame_path, 'rb') as stream:
        while True:
            line = stream.readline(MAX_FRAME_LINE + 1)
            if not line:
                break
            if len(line) > MAX_FRAME_LINE:
                raise ValueError('oversized frame record; existing output preserved')
            event = strict_json(line)
            if not isinstance(event, dict) or event.get('chain_id') != 56 or not block_number(event.get('block')):
                raise ValueError('invalid frame record')
            identifier = token_id(event.get('agent_id'))
            if identifier in seen:
                raise ValueError('duplicate frame id; do not silently merge registrations')
            seen.add(identifier); blocks.append(event['block'])
            record = current_by_id.get(identifier)
            if record is not None and 'error' in record and record['error'] is not None:
                outcomes['current_query_error'] += 1; continue
            if record is not None and (not block_number(record.get('block')) or record['block'] < event['block'] or not isinstance(record.get('token_uri'), str)):
                outcomes['invalid_current_record'] += 1; continue
            if record is not None:
                current_blocks.append(record['block'])
            registration_uri = (record if record is not None else event).get('token_uri')
            if not registration_uri:
                outcomes['missing_token_uri'] += 1; continue
            if third_party_uri(registration_uri):
                outcomes['third_party_metadata_excluded'] += 1; continue
            metadata = decode_inline(registration_uri)
            metadata_source = 'current_rpc_inline' if record is not None else 'registration_event_inline'
            if not isinstance(registration_uri, str):
                outcomes['invalid_metadata'] += 1; continue
            if not registration_uri.startswith('data:'):
                metadata = record.get('metadata') if record is not None else None
                # This offline importer did not fetch content at the RPC block.
                # Preserve supplied_cache provenance even when the owner/URI
                # itself was checked recently, including exact-URI cache joins.
                metadata_source = 'supplied_cache' if record is not None else 'registration_uri_fetch'
                resolution = resolved_by_uri.get(registration_uri)
                if metadata is None:
                    metadata = metadata_by_uri.get(registration_uri)
                if metadata is CONFLICT or metadata is None and resolution is CONFLICT:
                    outcomes['metadata_conflict'] += 1; continue
                if metadata is None and resolution is not None and fetch_failed(resolution):
                    outcomes['metadata_fetch_error'] += 1; continue
                if metadata is None and resolution is not None:
                    # Only recorded fields: missing description/image stay
                    # absent; do not turn resolver summaries into invented copy.
                    metadata = {'name': resolution.get('name'), 'x402Support': resolution.get('x402') is True,
                                'services': resolution.get('machine') or []}
                    metadata_source = 'supplied_cache_extracted_fields' if record is not None else 'registration_uri_extracted_fields'
                if metadata is None:
                    outcomes['metadata_unresolved'] += 1; continue
            if not valid_metadata(metadata):
                outcomes['invalid_metadata'] += 1; continue
            interfaces = declared_interfaces(metadata)
            if not interfaces:
                outcomes['no_usable_remote_interface'] += 1; continue
            def preference(interface):
                _, reading = resolve_assessment(interface, measured, links)
                published = reading is not None and reading.get('composite') is not None
                confirmed = reading is not None and reading.get('protocol_spoken') == interface['protocol']
                return (not published, not confirmed, reading is None, interface['protocol'] != 'mcp', interface['endpoint'])
            interfaces.sort(key=preference)
            # Give the existing pure taxonomy only registration-owned text.
            category, confidence, evidence = categorise({}, {'name': metadata['name'],
                'description': metadata.get('description', ''), 'raw_metadata': {'offchain_content': metadata}})
            selected = interfaces[0]
            _, assessment = resolve_assessment(selected, measured, links)
            owner = record.get('owner') if record is not None else None
            current_owner = isinstance(owner, str) and ADDRESS.fullmatch(owner) is not None
            if not current_owner:
                owner = event.get('owner')
            if not isinstance(owner, str) or ADDRESS.fullmatch(owner) is None:
                owner = None
            agents.append({'agent_id': f'56:{identifier}', 'token_id': identifier, 'chain_id': 56,
                'name': metadata['name'], 'description': metadata.get('description', ''),
                'image_url': metadata.get('image') if isinstance(metadata.get('image'), str) and not third_party_uri(metadata['image']) else None,
                'owner_address': owner, 'owner_source': 'current_rpc' if current_owner else 'registration_event' if owner else 'unknown',
                'owner_checked_at_block': record['block'] if current_owner else None,
                'registered_at_block': event['block'], 'metadata_source': metadata_source,
                'token_uri_checked_at_block': record['block'] if record is not None else None,
                'metadata_checked_at_block': record['block'] if metadata_source == 'current_rpc_inline' else None,
                'metadata_sha256': hashlib.sha256(json_bytes(metadata)).hexdigest(),
                'token_uri_sha256': hashlib.sha256(registration_uri.encode()).hexdigest(),
                'category': category, 'category_confidence': confidence, 'category_evidence': evidence,
                'category_source': 'self_reported_registration', 'protocols': sorted({x['protocol'] for x in interfaces}),
                'endpoint': selected['endpoint'], 'declared_interfaces': interfaces,
                'x402_supported': metadata.get('x402Support') is True,
                'detail_status': 'read', 'is_reference_agent': False,
                'assessment': dict(assessment) if assessment is not None else None})
            outcomes['published'] += 1
    unknown_current = set(current_by_id) - seen
    if unknown_current:
        raise ValueError('current records absent from committed frame; cannot silently change denominator')
    # One registration may declare both discovery and service URLs, or several
    # discovery URLs for one service. Count its actual target only once.
    fanout = Counter(key for agent in agents for key in {
        resolve_assessment(interface, measured, links)[0] for interface in agent['declared_interfaces']})
    for agent in agents:
        if agent['assessment'] is not None:
            key, _ = resolve_assessment(agent['declared_interfaces'][0], measured, links)
            count = fanout[key]
            agent['assessment'].update(endpoint_shared_with=count, shared_registration_count=count)
    agents.sort(key=lambda agent: int(agent['token_id']))
    return {'generated_at': as_of, 'agents': agents, 'source': {
        'kind': 'erc8004_registered_events', 'chain_id': 56, 'registry': IDENTITY_REGISTRY,
        'frame_file': frame_path.name, 'frame_sha256': digest, 'enumerated_records': len(seen),
        'event_block_range': {'min': min(blocks), 'max': max(blocks)} if blocks else None,
        'current_records': len(current_by_id), 'current_block_range': {'min': min(current_blocks), 'max': max(current_blocks)} if current_blocks else None,
        'current_input_sha256': hashlib.sha256(json_bytes(current)).hexdigest() if current is not None else None,
        'assessment_input_sha256': hashlib.sha256(json_bytes(assessments)).hexdigest() if assessments is not None else None,
        'recorded_interface_links': len(links),
        'resolved_input_sha256': hashlib.sha256(json_bytes(resolved)).hexdigest() if resolved is not None else None,
        'metadata_input_sha256': metadata_input_hash,
        'resolved_uris': len(resolved_by_uri), 'metadata_documents': len(metadata_by_uri),
        'resolution_failed_attempts': sum(fetch_failed(entry) for entry in (resolved.get('records', []) if isinstance(resolved, dict) else resolved or [])),
        'resolution_conflicting_uris': sum(value is CONFLICT for value in resolved_by_uri.values()),
        'metadata_conflicting_uris': sum(value is CONFLICT for value in metadata_by_uri.values()),
        'outcomes': dict(sorted(outcomes.items())), 'published_registrations': len(agents),
        'published_distinct_interfaces': len({(x['protocol'], x['endpoint']) for agent in agents for x in agent['declared_interfaces']}),
        'limitations': ['Registered-event URIs and owners are historical unless a current RPC observation is explicitly recorded.',
                       'An RPC owner/tokenURI block dates inline content only; supplied remote metadata retains cache provenance with unknown fetch freshness.',
                       'Unresolved metadata is unknown, not evidence of no service.',
                       'Successful URI observations are retained over failed attempts; absent timestamps do not establish which observation was latest.',
                       'Public URL syntax is not DNS vetting, reachability, safety, or behavioral verification.',
                       'Categories and interfaces are self-reported registration declarations.']}}


def write_atomic(path, payload):
    encoded = json_bytes(payload)  # Fail before touching an existing artifact.
    path = Path(path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + '.', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name); stream.write(encoded); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frame', type=Path, required=True)
    parser.add_argument('--current', type=Path)
    parser.add_argument('--assessments', type=Path)
    parser.add_argument('--resolved', type=Path, help='URI resolver records: JSON list or gzip NDJSON')
    parser.add_argument('--metadata', type=Path, help='Full registration documents {uri,doc}: JSON list or gzip NDJSON')
    parser.add_argument('--as-of', required=True, help='Explicit ISO timestamp; no wall clock is used')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    payload = build_dataset(args.frame, current=read_input(args.current), assessments=read_input(args.assessments),
                            resolved=read_input(args.resolved), metadata=read_input(args.metadata), as_of=args.as_of)
    write_atomic(args.out, payload)
    print(json.dumps(payload['source'], sort_keys=True))


def read_input(path):
    if path is None:
        return None
    if str(path).endswith(('.ndjson.gz', '.jsonl.gz')):
        records = []
        with gzip.open(path, 'rb') as stream:
            while True:
                line = stream.readline(MAX_FRAME_LINE + 1)
                if not line:
                    break
                if len(line) > MAX_FRAME_LINE:
                    raise ValueError('oversized URI metadata record')
                records.append(strict_json(line))
        return records
    return strict_json(Path(path).read_bytes())


if __name__ == '__main__':
    main()
