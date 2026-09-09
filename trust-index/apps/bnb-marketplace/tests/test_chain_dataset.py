"""Offline chain-source tests; run python -m unittest discover -s tests -p test_chain_dataset.py -v."""
import base64
import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest
from urllib.parse import quote

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import build_chain_dataset as builder


def uri(metadata):
    return 'data:application/json;base64,' + base64.b64encode(json.dumps(metadata).encode()).decode()


def row(identifier='1', metadata=None, **patch):
    return dict(chain_id=56, agent_id=identifier, owner='0x' + '11' * 20,
                block=100, token_uri=uri(metadata or {'name': 'Yield agent', 'description': 'Yield farming',
                'services': [{'name': 'MCP', 'endpoint': 'https://agent.example.net/mcp'}]}), **patch)


class ChainDatasetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.frame = Path(self.temp.name) / 'frame.ndjson.gz'

    def build(self, rows, **options):
        with gzip.open(self.frame, 'wt', encoding='utf8') as stream:
            for value in rows:
                stream.write(json.dumps(value) + '\n')
        return builder.build_dataset(self.frame, **options)

    def test_inline_metadata_and_owner_are_chain_sourced_not_scan_fields(self):
        payload = self.build([row()], as_of='2026-09-09T00:00:00Z')
        agent = payload['agents'][0]
        self.assertEqual((agent['agent_id'], agent['token_id'], agent['category']), ('56:1', '1', 'yield'))
        self.assertEqual(agent['owner_source'], 'registration_event')
        self.assertIsNone(agent['owner_checked_at_block'])
        self.assertEqual(agent['metadata_source'], 'registration_event_inline')
        self.assertIsNone(agent['assessment'])
        self.assertFalse(any(key.startswith('scan_') for key in agent))
        self.assertEqual(payload['source']['event_block_range'], {'min': 100, 'max': 100})
        self.assertEqual(payload['source']['outcomes'], {'published': 1})
        self.assertEqual(payload, self.build([row()], as_of='2026-09-09T00:00:00Z'))

    def test_array_and_object_services_percent_encoding_and_protocol_preserved(self):
        metadata = {'name': 'Agent', 'services': {'ens': 'agent.eth', 'MCP': {'endpoint': 'https://AGENT.example.net:443/mcp'},
                    'a2a': {'url': 'https://agent.example.net/a2a'}, 'web': 'https://github.com/org/repo'}}
        event = row(metadata=metadata)
        event['token_uri'] = 'data:application/json;charset=utf-8,' + quote(json.dumps(metadata))
        agents = self.build([event])['agents']
        self.assertEqual(agents[0]['declared_interfaces'], [
            {'protocol': 'mcp', 'endpoint': 'https://agent.example.net/mcp'},
            {'protocol': 'a2a', 'endpoint': 'https://agent.example.net/a2a'}])

    def test_current_error_excludes_old_inline_and_current_metadata_replaces_it(self):
        current = {'records': [
            {'agent_id': '1', 'block': 200, 'token_uri': uri({'name': 'Changed', 'services': [{'name':'A2A','endpoint':'https://new.example.net/a2a'}]}), 'owner': '0x' + '22'*20},
            {'agent_id': '56:2', 'block': 200, 'error': 'RPC failed'}]}
        result = self.build([row(), row('2')], current=current)
        self.assertEqual(len(result['agents']), 1)
        self.assertEqual(result['agents'][0]['name'], 'Changed')
        self.assertEqual(result['agents'][0]['owner_source'], 'current_rpc')
        self.assertEqual(result['agents'][0]['owner_checked_at_block'], 200)
        self.assertEqual(result['source']['outcomes'], {'current_query_error': 1, 'published': 1})

    def test_all_unresolved_frames_count_without_claiming_no_interface(self):
        remote, empty, invalid = row('2'), row('3'), row('4')
        remote['token_uri']='https://metadata.example.net/2'; empty['token_uri']=''; invalid['token_uri']='data:application/json;base64,!!!'
        result=self.build([row(),remote,empty,invalid,row('5',metadata={'name':'Only web','services':[{'name':'web','endpoint':'https://public.example.net'}]})])
        self.assertEqual(result['source']['enumerated_records'],5)
        self.assertEqual(result['source']['outcomes'], {'published':1,'metadata_unresolved':1,'missing_token_uri':1,'invalid_metadata':1,'no_usable_remote_interface':1})
        self.assertEqual(sum(result['source']['outcomes'].values()),5)

    def test_templates_social_private_and_stdio_are_not_remote_interfaces(self):
        for endpoint in ['https://github.com/org/repo','https://x.com/agent','http://127.0.0.1/mcp','http://169.254.169.254/mcp','https://agent.local/mcp','https://{host}/mcp','https://api.example.net/{agent_id}','https://api.example.net/%7Bagent_id%7D','https://user:pass@api.example.net/mcp']:
            with self.subTest(endpoint=endpoint):
                self.assertEqual(self.build([row(metadata={'name':'Agent','services':[{'name':'MCP','endpoint':endpoint}]})])['agents'],[])
        self.assertEqual(self.build([row(metadata={'name':'Agent','services':{'mcp':{'endpoint':'https://agent.example.net/info','transport':'stdio'}}})])['agents'],[])

    def test_assessments_join_only_exact_normalized_endpoint_and_protocol(self):
        assessment={'reachable':True,'protocol_spoken':'mcp','tools_or_skills':['read'],'tool_count':1,'latency_ms':1,'coverage':'thin','composite':72,'withheld_reason':None,'gates_fired':[],'checked_at':'2026-09-09T00:00:00Z'}
        for endpoint, protocol, matches in [('https://AGENT.example.net:443/mcp','mcp',True),('https://agent.example.net/a2a','mcp',False),('https://agent.example.net/mcp','a2a',False),('https://other.example.net/mcp','mcp',False)]:
            entry={**assessment,'protocol_spoken':protocol}
            result=self.build([row(),row('2')],assessments={'assessments':[{'endpoint':endpoint,'protocol':protocol,'assessment':entry}]})
            self.assertEqual(result['agents'][0]['assessment'] is not None,matches)
            if matches:
                self.assertEqual(result['agents'][0]['assessment']['endpoint_shared_with'],2)
                self.assertEqual(result['agents'][0]['assessment']['composite'],72)

    def test_remote_current_metadata_and_missing_current_owner_are_explicit(self):
        current={'records':[{'agent_id':'1','token_uri':'https://meta.example.net/1','block':201,'metadata':{'name':'Fetched','services':[{'name':'mcp','endpoint':'https://new.example.net/mcp'}]}}]}
        agent=self.build([row()],current=current)['agents'][0]
        self.assertEqual(agent['metadata_source'],'supplied_cache')
        self.assertIsNone(agent['metadata_checked_at_block'])
        self.assertEqual(agent['owner_source'],'registration_event')
        self.assertIsNone(agent['owner_checked_at_block'])

    def test_uri_join_fans_out_fetched_documents_and_ignores_resolver_owner(self):
        one,two=row(),row('2')
        one['token_uri']=two['token_uri']='https://metadata.example.net/shared'
        resolved=[{'agent_id':'1','owner':'0x'+'ff'*20,'uri':one['token_uri'],'name':'Old summary','machine':[{'type':'MCP','url':'https://old.example.net/mcp'}]}]
        metadata=[{'uri':one['token_uri'],'doc':{'name':'Actual registration','description':'Research agent','image':'https://images.example.net/a.png','services':[{'name':'A2A','endpoint':'https://live.example.net/a2a'}]}}]
        result=self.build([one,two],resolved=resolved,metadata=metadata)
        self.assertEqual(len(result['agents']),2)
        for agent in result['agents']:
            self.assertEqual(agent['name'],'Actual registration')
            self.assertEqual(agent['endpoint'],'https://live.example.net/a2a')
            self.assertEqual(agent['owner_address'],'0x'+'11'*20)
            self.assertEqual(agent['metadata_source'],'registration_uri_fetch')

    def test_resolved_fallback_has_no_invented_description_and_errors_are_gaps(self):
        one,two=row(),row('2')
        one['token_uri']='ipfs://content-id';two['token_uri']='https://metadata.example.net/fail'
        resolved=[{'uri':one['token_uri'],'name':'Resolved name','machine':[{'type':'MCP','url':'https://remote.example.net/mcp'},{'type':'web','url':'https://other.example.net'}]},
                  {'uri':two['token_uri'],'fetch_error':'timeout','http_status':504,'name':'Stale','machine':[{'type':'MCP','url':'https://old.example.net/mcp'}]}]
        result=self.build([one,two],resolved=resolved)
        self.assertEqual(result['agents'][0]['description'],'')
        self.assertEqual(result['agents'][0]['metadata_source'],'registration_uri_extracted_fields')
        self.assertEqual(result['source']['outcomes'],{'published':1,'metadata_fetch_error':1})

    def test_8004scan_urls_are_not_imported_as_metadata_interfaces_or_images(self):
        for domain in ['8004scan.io','8004scan.com','8004scan.app']:
            with self.subTest(domain=domain):
                event=row(metadata={'name':'Agent','image':f'https://cdn.{domain}/image.png','services':[{'name':'mcp','endpoint':'https://agent.example.net/mcp'}]})
                self.assertIsNone(self.build([event])['agents'][0]['image_url'])
                self.assertIsNone(builder.normalized_endpoint(f'https://{domain}/agent'))
                self.assertIsNone(builder.normalized_endpoint(f'https://api.{domain}/mcp'))
                event['token_uri']=f'https://{domain}/metadata/1'
                result=self.build([event],metadata=[{'uri':event['token_uri'],'doc':{'name':'Agent','services':[{'name':'mcp','endpoint':'https://agent.example.net/mcp'}]}}])
                self.assertEqual(result['agents'],[])

    def test_current_uri_cache_does_not_acquire_rpc_metadata_freshness(self):
        document={'name':'Cached registration','services':[{'name':'mcp','endpoint':'https://agent.example.net/mcp'}]}
        record={'agent_id':'1','token_uri':'https://meta.example.net/1','block':201,'owner':'0x'+'22'*20,
                'metadata':document,'metadata_source':'supplied_cache'}
        for embedded in [True,False]:
            value=dict(record)
            if not embedded: value.pop('metadata')
            agent=self.build([row()],current={'records':[value]},metadata=[{'uri':record['token_uri'],'doc':document}])['agents'][0]
            self.assertEqual(agent['metadata_source'],'supplied_cache')
            self.assertIsNone(agent['metadata_checked_at_block'])
            self.assertEqual(agent['owner_checked_at_block'],201)
            self.assertEqual(agent['token_uri_checked_at_block'],201)
        record['token_uri']=uri(document)
        inline=self.build([row()],current={'records':[record]})['agents'][0]
        self.assertEqual(inline['metadata_source'],'current_rpc_inline')
        self.assertEqual(inline['metadata_checked_at_block'],201)

    def test_current_uri_extracted_cache_has_no_rpc_metadata_freshness(self):
        current={'records':[{'agent_id':'1','token_uri':'https://meta.example.net/1','block':201}]}
        resolved=[{'uri':'https://meta.example.net/1','name':'Cached','machine':[{'type':'MCP','url':'https://agent.example.net/mcp'}]}]
        agent=self.build([row()],current=current,resolved=resolved)['agents'][0]
        self.assertEqual(agent['metadata_source'],'supplied_cache_extracted_fields')
        self.assertIsNone(agent['metadata_checked_at_block'])

    def test_malformed_oversized_and_duplicate_inputs_do_not_overwrite_output(self):
        self.assertEqual(self.build([row(metadata={'name':'x' * 600,'services':[]})])['agents'],[])
        self.assertEqual(builder.decode_inline('data:application/json,'+'x'*(builder.MAX_METADATA_BYTES+1)),None)
        with self.assertRaises(ValueError): self.build([row(),row()])
        with self.assertRaises(ValueError): self.build([row()],current={'records':[{'agent_id':'1','block':200},{'agent_id':'1','block':201}]})
        target=Path(self.temp.name)/'output.json'; target.write_text('existing')
        with self.assertRaises(ValueError): builder.write_atomic(target, {'bad':float('nan')})
        self.assertEqual(target.read_text(),'existing')

    def test_gzip_document_input_and_conflicting_uri_records_fail_closed(self):
        document={'uri':'https://meta.example.net/shared','doc':{'name':'Agent','services':[]}}
        path=Path(self.temp.name)/'metadata.ndjson.gz'
        with gzip.open(path,'wt',encoding='utf8') as stream:
            stream.write(json.dumps(document)+'\n')
        self.assertEqual(builder.read_input(path),[document])
        event=row();event['token_uri']=document['uri']
        result=self.build([event],metadata=[document,{**document,'doc':{'name':'Different'}}])
        self.assertEqual(result['source']['outcomes'],{'metadata_conflict':1})

    def test_assessment_alias_mismatch_and_nonfinite_rating_fail_closed(self):
        base={'endpoint':'https://agent.example.net/mcp','protocol':'mcp','assessment':{
            'protocol_spoken':'mcp','coverage':'thin','composite':50,'checked_at':'2026-09-09T00:00:00Z'}}
        for change in [{'evidence_endpoint':'https://different.example.net/mcp'}, {'evidence_scope':'host'}, {'composite':float('nan')}, {'protocol_spoken':'a2a'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.build([row()],assessments={'assessments':[{**base,'assessment':{**base['assessment'],**change}}]})

    def test_measured_a2a_is_selected_over_unmeasured_mcp_without_relabelling(self):
        metadata={'name':'Agent','services':[{'name':'MCP','endpoint':'https://agent.example.net/mcp'},{'name':'A2A','endpoint':'https://agent.example.net/a2a'}]}
        assessments={'assessments':[{'endpoint':'https://agent.example.net/a2a','protocol':'a2a','assessment':{'protocol_spoken':'a2a','coverage':'thin','composite':70,'checked_at':'2026-09-09T00:00:00Z'}}]}
        agent=self.build([row(metadata=metadata)],assessments=assessments)['agents'][0]
        self.assertEqual(agent['endpoint'],'https://agent.example.net/a2a')
        self.assertEqual(agent['assessment']['protocol_spoken'],'a2a')
        self.assertEqual(agent['assessment']['composite'],70)

    def linked_fixture(self):
        declared='https://cards.example.net/.well-known/agent.json'
        measured='https://service.example.net/a2a'
        entry={'endpoint':measured,'protocol':'a2a','assessment':{'protocol_spoken':'a2a',
            'coverage':'thin','composite':70,'checked_at':'2026-09-09T09:00:00Z'},
            'provenance':{'score_as_of':'2026-09-09T02:00:00Z','scored_generated_at':'2026-09-09T10:00:00Z',
                'probe_observed_at':'2026-09-09T09:00:00Z','battery_observed_at':['2026-09-09T08:00:00Z'],
                'transcript_sha256':'a'*64,'battery_sha256':'b'*64}}
        link={'protocol':'a2a','declared_endpoint':declared,'measured_endpoint':measured,'transcript_sha256':'a'*64}
        event=row(metadata={'name':'Linked agent','services':[{'name':'a2a','endpoint':declared}]})
        return event,entry,link

    def test_recorded_a2a_link_keeps_connection_declaration_and_measurement_provenance(self):
        event,entry,link=self.linked_fixture()
        agent=self.build([event],assessments={'assessments':[entry],'interface_links':[link]})['agents'][0]
        self.assertEqual(agent['endpoint'],link['declared_endpoint'])
        self.assertEqual(agent['assessment']['evidence_endpoint'],entry['endpoint'])
        self.assertEqual(agent['assessment']['evidence_declared_endpoint'],link['declared_endpoint'])
        self.assertEqual(agent['assessment']['evidence_link_sha256'],link['transcript_sha256'])
        self.assertEqual(agent['assessment']['provenance'],entry['provenance'])
        self.assertEqual(agent['assessment']['checked_at'],'2026-09-09T09:00:00Z')
        self.assertIsNone(self.build([event],assessments={'assessments':[entry]})['agents'][0]['assessment'])

    def test_direct_exact_assessment_wins_over_recorded_link(self):
        event,entry,link=self.linked_fixture()
        direct={**entry,'endpoint':link['declared_endpoint'],'assessment':{**entry['assessment'],'composite':None}}
        agent=self.build([event],assessments={'assessments':[entry,direct],'interface_links':[link]})['agents'][0]
        self.assertIsNone(agent['assessment']['composite'])
        self.assertEqual(agent['assessment']['evidence_endpoint'],link['declared_endpoint'])
        self.assertNotIn('evidence_link_sha256',agent['assessment'])

    def test_invalid_or_conflicting_interface_links_fail_closed(self):
        event,entry,link=self.linked_fixture()
        for changes in [{'protocol':'mcp'},{'transcript_sha256':'not-a-hash'},
                        {'measured_endpoint':'https://unknown.example.net/a2a'},
                        {'declared_endpoint':'https://8004scan.app/card'},
                        {'measured_endpoint':link['declared_endpoint']}]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):
                self.build([event],assessments={'assessments':[entry],'interface_links':[{**link,**changes}]})
        for conflict in [{'transcript_sha256':'c'*64},{'measured_endpoint':'https://second.example.net/a2a'}]:
            other={**entry,'endpoint':'https://second.example.net/a2a'}
            with self.subTest(conflict=conflict),self.assertRaises(ValueError):
                self.build([event],assessments={'assessments':[entry,other],'interface_links':[link,{**link,**conflict}]})

    def test_linked_fanout_counts_actual_service_once_per_registration(self):
        event,entry,link=self.linked_fixture()
        second_link={**link,'declared_endpoint':'https://other-cards.example.net/card.json'}
        second=row('2',metadata={'name':'Second','services':[
            {'name':'a2a','endpoint':second_link['declared_endpoint']},
            {'name':'a2a','endpoint':link['measured_endpoint']},
            {'name':'a2a','endpoint':link['declared_endpoint']}]})
        result=self.build([event,second],assessments={'assessments':[entry],
            'interface_links':[link,second_link,dict(link)]})
        for agent in result['agents']:
            self.assertEqual(agent['assessment']['endpoint_shared_with'],2)
            self.assertEqual(agent['assessment']['shared_registration_count'],2)

    def test_success_is_retained_over_failed_fetch_without_claiming_latest(self):
        event=row();event['token_uri']='https://meta.example.net/1'
        good={'uri':event['token_uri'],'name':'Agent','http_status':200,'machine':[{'type':'MCP','url':'https://agent.example.net/mcp'}]}
        bad={'uri':event['token_uri'],'fetch_error':'http429','http_status':429}
        for records in [[good,bad],[bad,good]]:
            result=self.build([event],resolved=records)
            self.assertEqual(len(result['agents']),1)
            self.assertEqual(result['source']['resolution_failed_attempts'],1)
        result=self.build([event],resolved=[bad],metadata=[{'uri':event['token_uri'],'doc':{'name':'Actual','services':[{'name':'mcp','endpoint':'https://agent.example.net/mcp'}]}}])
        self.assertEqual(result['agents'][0]['name'],'Actual')

    def test_fanout_counts_declared_secondary_interfaces_not_only_selected_rows(self):
        a2a={'name':'A2A','endpoint':'https://agent.example.net/a2a'}
        mcp={'name':'MCP','endpoint':'https://agent.example.net/mcp'}
        readings={'assessments':[{'endpoint':item['endpoint'],'protocol':item['name'].lower(),
            'assessment':{'protocol_spoken':item['name'].lower(),'coverage':'thin','composite':70,'checked_at':'2026-09-09T00:00:00Z'}} for item in [mcp,a2a]]}
        result=self.build([row(metadata={'name':'First','services':[a2a]}),row('2',metadata={'name':'Second','services':[mcp,a2a]})],assessments=readings)
        self.assertEqual(result['agents'][0]['assessment']['endpoint_shared_with'],2)
        self.assertEqual(result['agents'][1]['endpoint'],mcp['endpoint'])


if __name__ == '__main__': unittest.main()
