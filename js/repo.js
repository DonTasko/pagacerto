/* PagaCerto — repositórios. A UI só fala com isto, nunca diretamente com o IndexedDB.
 * Se um dia houver sincronização, é aqui que se liga (mesma API, outro destino).
 */
(function (root) {
  'use strict';
  const DB = root.PagaDB;
  const M = root.PagaModels;

  const payments = {
    async list() {
      const all = await DB.getAll('payments');
      return all.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.issuer || '').localeCompare(b.issuer || ''));
    },
    get: id => DB.get('payments', id),
    save: p => DB.put('payments', p),
    saveMany: list => DB.putMany('payments', list),
    remove: id => DB.del('payments', id),
    clearAll: () => DB.clear('payments'),
    async removeSamples() {
      const ids = (await DB.getAll('payments')).filter(p => p.sample).map(p => p.id);
      await DB.delMany('payments', ids);
      return ids.length;
    },
    async markPaid(id, method) {
      const p = await DB.get('payments', id);
      if (!p) return null;
      p.status = 'paid';
      p.paidAt = new Date().toISOString(); // data e hora do pagamento
      p.paidMethod = method || '';
      await DB.put('payments', p);
      return p;
    },
    async reopen(id) {
      const p = await DB.get('payments', id);
      if (!p) return null;
      p.status = 'pending';
      delete p.paidAt;
      delete p.paidMethod;
      await DB.put('payments', p);
      return p;
    }
  };

  const settings = {
    async get(key, fallback) {
      const row = await DB.get('settings', key);
      return row ? row.value : fallback;
    },
    set: (key, value) => DB.put('settings', { key, value })
  };

  // "Entidade 12345 = EDP": aprende-se quando o utilizador confirma um pagamento.
  const entities = {
    async map() {
      const rows = await DB.getAll('entities');
      return Object.fromEntries(rows.map(r => [r.entity, r.issuer]));
    },
    remember: (entity, issuer) => DB.put('entities', { entity, issuer }),
    clear: () => DB.clear('entities')
  };

  const categories = {
    async list() {
      const custom = (await DB.getAll('categories')).map(c => c.name);
      return M.CATEGORIES.concat(custom.filter(c => !M.CATEGORIES.includes(c)));
    },
    add: name => DB.put('categories', { name })
  };

  // Dados de exemplo da spec (secção 27). Marcados com sample:true para se poderem remover.
  async function seedSamples() {
    const mk = o => Object.assign(M.emptyPayment(), { sample: true }, o);
    const list = [
      mk({ issuer: 'EDP', amountCents: 8743, dueDate: '2026-10-10', entity: '12345', reference: '123456789', category: 'Eletricidade', invoiceNumber: 'FT 2026/12345' }),
      mk({ issuer: 'Vodafone', amountCents: 3499, dueDate: '2026-10-15', entity: '54321', reference: '987654321', category: 'Telecomunicações' }),
      mk({ issuer: 'Segurança Social', amountCents: 12000, dueDate: '2026-10-10', category: 'Segurança Social', installmentNo: 1, installmentTotal: 12 }),
      mk({ issuer: 'Financiamento', amountCents: 25000, dueDate: '2026-10-05', category: 'Financiamentos', installmentNo: 6, installmentTotal: 48 })
    ];
    await DB.putMany('payments', list);
    await entities.remember('12345', 'EDP');
    await entities.remember('54321', 'Vodafone');
    return list.length;
  }

  async function wipeEverything() {
    await Promise.all(['payments', 'entities', 'categories'].map(s => DB.clear(s)));
  }

  root.PagaRepo = { payments, settings, entities, categories, seedSamples, wipeEverything };
}(typeof self !== 'undefined' ? self : this));
