import { describe, expect, it } from 'vitest';
import { snapshotToRawEvents } from '../src/capture.js';
import { DownNer, HeuristicNer } from '../src/ner.js';
import { RedactionPipeline, type PersistSink } from '../src/pipeline.js';
import type { AxSnapshot, ObserverEvent } from '../src/types.js';

class MemorySink implements PersistSink {
  events: ObserverEvent[] = [];
  append(event: ObserverEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

const snapshot: AxSnapshot = {
  window: { app: 'MailDraft', bundleId: 'com.example.maildraft', title: 'Re: Marlowe Greenbriar — Invoice 7702' },
  url: 'https://mail.example.com/threads/8842?q=secret',
  axTree: {
    role: 'window',
    children: [
      { role: 'textbox', label: 'To', value: 'marlowe@greenbriar.example', action: 'edit' },
      { role: 'textbox', label: 'Subject', value: 'Final invoice', action: 'edit' },
      { role: 'textbox', secure: true, label: 'App password', value: 'tr0ub4dor-3', action: 'edit' },
      { role: 'button', label: 'Send', action: 'press' },
    ],
  },
  frameRef: 'blob_abc123',
};

describe('capture normalization (layer 1, C4)', () => {
  it('secure fields produce no value, no label, no frame — at capture', () => {
    const raw = snapshotToRawEvents(snapshot, 'ses_test');
    const secure = raw.find((e) => e.ax?.secureSuppressed === true);
    expect(secure).toBeDefined();
    expect(secure!.frameRef).toBeNull();
    expect(JSON.stringify(secure)).not.toContain('tr0ub4dor');
    expect(JSON.stringify(secure)).not.toContain('App password');
    expect(secure!.ax!.rolePath).toContain('[secure]');
  });
});

describe('pipeline (layers 2–3 + persistence)', () => {
  it('persists fully-redacted events: values dropped, title/label redacted, url scrubbed', async () => {
    const sink = new MemorySink();
    const pipeline = new RedactionPipeline({ ner: new HeuristicNer(), sink });

    for (const raw of snapshotToRawEvents(snapshot, 'ses_test')) {
      const result = await pipeline.process(raw);
      expect(result.action).toBe('persisted');
    }

    const persisted = JSON.stringify(sink.events);
    expect(persisted).not.toContain('marlowe@greenbriar.example');
    expect(persisted).not.toContain('tr0ub4dor');
    expect(persisted).not.toContain('Marlowe Greenbriar');
    expect(persisted).not.toContain('q=secret');
    expect(persisted).not.toContain('7702');

    const first = sink.events[0]!;
    expect(first.window.title_redacted).toBe('Re: {PERSON} — Invoice {NUM}');
    expect(first.url).toEqual({ host: 'mail.example.com', path_template: '/threads/{id}' });

    const toField = sink.events.find((e) => e.ax?.label_redacted === 'To')!;
    expect(toField.ax!.value_class).toBe('email');

    const secureField = sink.events.find((e) => e.ax?.label_redacted === '{SECURE}')!;
    expect(secureField.ax!.value_class).toBe('none');
    expect(secureField.frame_ref).toBeNull();
  });

  it('drops blocked-category events before persistence (C5)', async () => {
    const sink = new MemorySink();
    const pipeline = new RedactionPipeline({ ner: new HeuristicNer(), sink });
    const banking: AxSnapshot = {
      ...snapshot,
      window: { app: 'Chrome', bundleId: 'com.google.Chrome', title: 'Accounts', category: 'banking' },
    };
    for (const raw of snapshotToRawEvents(banking, 'ses_test')) {
      const result = await pipeline.process(raw);
      expect(result).toEqual({ action: 'blocked_category', category: 'banking' });
    }
    expect(sink.events).toHaveLength(0);
  });

  it('fail-closed: NER down halts the pipeline and persists nothing', async () => {
    const sink = new MemorySink();
    let haltReason: string | null = null;
    const pipeline = new RedactionPipeline({
      ner: new DownNer(),
      sink,
      onHalt: (reason) => {
        haltReason = reason;
      },
    });

    const raw = snapshotToRawEvents(snapshot, 'ses_test');
    expect(await pipeline.process(raw[0]!)).toEqual({ action: 'halted_ner_unavailable' });
    expect(pipeline.halted).toBe(true);
    expect(haltReason).toBe('ner_unavailable');

    // and it STAYS halted for subsequent events until resumed
    expect(await pipeline.process(raw[1]!)).toEqual({ action: 'halted_ner_unavailable' });
    expect(sink.events).toHaveLength(0);

    pipeline.resume();
    expect(pipeline.halted).toBe(false);
  });

  it('layer-4 exclusions feed back into layer 2', async () => {
    const sink = new MemorySink();
    const pipeline = new RedactionPipeline({ ner: new HeuristicNer(), sink });
    pipeline.addExclusions({ appNames: ['MailDraft'] });
    const result = await pipeline.process(snapshotToRawEvents(snapshot, 'ses_test')[0]!);
    expect(result).toEqual({ action: 'blocked_category', category: 'user_exclusion' });
    expect(sink.events).toHaveLength(0);
  });
});
