const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    blocker: row.blocker,
    blocked: row.blocked,
    createdAt: row.created_at,
  };
}

function hydrate(plain) {
  if (!plain) return null;
  return {
    ...plain,
    _id: plain.id,
    async deleteOne() {
      await query('DELETE FROM blocks WHERE id = $1', [plain.id]);
    },
    toObject() {
      return { ...plain, _id: plain.id };
    },
  };
}

function buildOrMatch(filter, params) {
  if (filter.$or && Array.isArray(filter.$or)) {
    const parts = [];
    for (const clause of filter.$or) {
      if (clause.blocker && clause.blocked) {
        const a = params.length + 1;
        const b = params.length + 2;
        parts.push(`(blocker = $${a} AND blocked = $${b})`);
        params.push(String(clause.blocker), String(clause.blocked));
      } else if (clause.blocker) {
        const a = params.length + 1;
        parts.push(`blocker = $${a}`);
        params.push(String(clause.blocker));
      } else if (clause.blocked) {
        const a = params.length + 1;
        parts.push(`blocked = $${a}`);
        params.push(String(clause.blocked));
      }
    }
    return parts.length ? `(${parts.join(' OR ')})` : 'TRUE';
  }
  if (filter.blocker && filter.blocked) {
    const a = params.length + 1;
    const b = params.length + 2;
    params.push(String(filter.blocker), String(filter.blocked));
    return `blocker = $${a} AND blocked = $${b}`;
  }
  return 'TRUE';
}

function selectChain(filter, multi) {
  const st = { filter, multi, _select: null };
  const chain = {
    select() {
      return chain;
    },
    async exec() {
      const params = [];
      const w = buildOrMatch(st.filter, params);
      const lim = multi ? '' : 'LIMIT 1';
      const res = await query(`SELECT * FROM blocks WHERE ${w} ${lim}`, params);
      if (multi) return res.rows.map((r) => hydrate(fromRow(r)));
      return res.rows[0] ? hydrate(fromRow(res.rows[0])) : null;
    },
    then(onF, onR) {
      return chain.exec().then(onF, onR);
    },
    catch(onR) {
      return chain.exec().catch(onR);
    },
  };
  return chain;
}

const Block = {
  find(filter) {
    return selectChain(filter, true);
  },
  findOne(filter) {
    return selectChain(filter, false);
  },
  async create(data) {
    const id = newObjectId();
    await query('INSERT INTO blocks (id, blocker, blocked) VALUES ($1,$2,$3)', [
      id,
      String(data.blocker),
      String(data.blocked),
    ]);
    return hydrate(fromRow((await query('SELECT * FROM blocks WHERE id=$1', [id])).rows[0]));
  },
};

module.exports = Block;
