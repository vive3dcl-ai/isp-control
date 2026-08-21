import {
  looksLikeDeferredToolIntent,
  looksLikeIncompleteAgentTurn,
  looksLikeToolRefusal,
  parseAgentAction,
  toolCallSignature,
} from './ai-tool-protocol';

describe('parseAgentAction', () => {
  it('parses tool fence', () => {
    const r = parseAgentAction(
      '```tool\n{"name":"onu_lookup","arguments":{"sn":"ABC"}}\n```',
    );
    expect(r.kind).toBe('tool');
    if (r.kind === 'tool') {
      expect(r.name).toBe('onu_lookup');
      expect(r.arguments.sn).toBe('ABC');
    }
  });

  it('parses skill fence', () => {
    const r = parseAgentAction(
      '```skill\n{"name":"onu_verify_diagnose"}\n```',
    );
    expect(r.kind).toBe('skill');
    if (r.kind === 'skill') {
      expect(r.name).toBe('onu_verify_diagnose');
    }
  });

  it('parses yaml-ish tool fence', () => {
    const r = parseAgentAction(
      '```tool\nname: ui_open_view\narguments:\n  view: client\n  clientId: f87d0ba2-990c-42dc-9d93-58d81907d826\n```',
    );
    expect(r.kind).toBe('tool');
    if (r.kind === 'tool') {
      expect(r.name).toBe('ui_open_view');
      expect(r.arguments.view).toBe('client');
      expect(r.arguments.clientId).toBe(
        'f87d0ba2-990c-42dc-9d93-58d81907d826',
      );
    }
  });

  it('parses bare json tool', () => {
    const r = parseAgentAction(
      'Voy a abrir:\n{"name":"ui_open_view","arguments":{"view":"client","clientId":"abc"}}\n',
    );
    expect(r.kind).toBe('tool');
    if (r.kind === 'tool') {
      expect(r.name).toBe('ui_open_view');
      expect(r.arguments.clientId).toBe('abc');
    }
  });

  it('returns text when no fence', () => {
    const r = parseAgentAction('La ONU está OK.');
    expect(r).toEqual({ kind: 'text', text: 'La ONU está OK.' });
  });
});

describe('looksLikeToolRefusal', () => {
  it('detects common refusals', () => {
    expect(
      looksLikeToolRefusal(
        'en esta conversación no tengo ejecución de tools habilitada',
      ),
    ).toBe(true);
    expect(
      looksLikeToolRefusal('Si el entorno habilita tools, la abriría'),
    ).toBe(true);
    expect(looksLikeToolRefusal('Listo, abrí la ficha.')).toBe(false);
  });
});

describe('looksLikeDeferredToolIntent', () => {
  it('detects announced-but-not-executed actions', () => {
    expect(
      looksLikeDeferredToolIntent(
        'Voy a revisar si ya existe la VLAN 345 en ether5; si no existe, la creo.',
      ),
    ).toBe(true);
    expect(looksLikeDeferredToolIntent('La creo ahora.')).toBe(true);
    expect(
      looksLikeDeferredToolIntent('Listo: VLAN 345 creada en ether5.'),
    ).toBe(false);
  });
});

describe('looksLikeIncompleteAgentTurn', () => {
  it('flags offers and mid-thought stops', () => {
    expect(
      looksLikeIncompleteAgentTurn('Puedo buscar el cliente si quieres.'),
    ).toBe(true);
    expect(
      looksLikeIncompleteAgentTurn(
        'Siguiente paso: abrir la ficha del cliente.',
      ),
    ).toBe(true);
    expect(
      looksLikeIncompleteAgentTurn('Estoy revisando el router…'),
    ).toBe(true);
    expect(looksLikeIncompleteAgentTurn('', { toolsUsed: 0 })).toBe(true);
  });

  it('allows finished summaries', () => {
    expect(
      looksLikeIncompleteAgentTurn(
        'Listo: unifiqué los duplicados y abrí la ficha del cliente principal.',
        { toolsUsed: 3 },
      ),
    ).toBe(false);
  });
});

describe('toolCallSignature', () => {
  it('is stable regardless of key order', () => {
    expect(
      toolCallSignature('crm_search_clients', { q: 'ana', limit: 5 }),
    ).toBe(
      toolCallSignature('crm_search_clients', { limit: 5, q: 'ana' }),
    );
  });
});
