const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function fromRow(row) {
  if (!row) return null;
  let settings = row.settings;
  if (settings && typeof settings === 'string') {
    try {
      settings = JSON.parse(settings);
    } catch {
      settings = {};
    }
  }
  if (!settings || typeof settings !== 'object') {
    settings = { displayChat: true, notificationsEnabled: true, autoModeration: true };
  }
  return {
    id: row.id,
    _id: row.id,
    title: row.title,
    description: row.description,
    thumbnail: row.thumbnail,
    audience: row.audience,
    scheduledTime: row.scheduled_time,
    status: row.status,
    creatorId: row.creator_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    duration: row.duration,
    peakViewers: row.peak_viewers,
    recordingUrl: row.recording_url,
    settings,
    viewerCount: row.viewer_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function persist(plain) {
  await query(
    `UPDATE livestreams SET
      title=$2, description=$3, thumbnail=$4, audience=$5, scheduled_time=$6, status=$7, creator_id=$8,
      started_at=$9, ended_at=$10, duration=$11, peak_viewers=$12, recording_url=$13, settings=$14::jsonb,
      viewer_count=$15, updated_at=now()
    WHERE id=$1`,
    [
      plain.id,
      plain.title,
      plain.description,
      plain.thumbnail,
      plain.audience,
      plain.scheduledTime,
      plain.status,
      String(plain.creatorId),
      plain.startedAt || null,
      plain.endedAt || null,
      plain.duration ?? 0,
      plain.peakViewers ?? 0,
      plain.recordingUrl || '',
      JSON.stringify(plain.settings || {}),
      plain.viewerCount ?? 0,
    ]
  );
}

function hydrate(plain) {
  if (!plain) return null;
  return {
    ...plain,
    _id: plain.id,
    async save() {
      await persist({ ...plain });
    },
    toObject() {
      return { ...plain, _id: plain.id };
    },
  };
}

function buildWhere(f, params) {
  const parts = [];
  let i = params.length + 1;
  if (f._id) {
    parts.push(`id = $${i}`);
    params.push(String(f._id));
    i += 1;
  }
  if (f.creatorId) {
    parts.push(`creator_id = $${i}`);
    params.push(String(f.creatorId));
    i += 1;
  }
  if (f.status && f.status.$in) {
    parts.push(`status = ANY($${i}::text[])`);
    params.push(f.status.$in);
    i += 1;
  } else if (f.status) {
    parts.push(`status = $${i}`);
    params.push(f.status);
    i += 1;
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function chain(filter, multi) {
  const st = { filter, multi, _sort: null, _limit: null, _populates: [] };
  const c = {
    populate(path, sel) {
      st._populates.push({ path, select: sel });
      return c;
    },
    sort(spec) {
      st._sort = spec;
      return c;
    },
    async exec() {
      const params = [];
      const w = buildWhere(st.filter, params);
      let order = 'ORDER BY created_at DESC';
      if (st._sort) {
        const k = Object.keys(st._sort)[0];
        const dir = st._sort[k] === 1 ? 'ASC' : 'DESC';
        if (k === 'startedAt') order = `ORDER BY started_at ${dir}`;
        else if (k === 'scheduledTime') order = `ORDER BY scheduled_time ${dir}`;
        else if (k === 'createdAt') order = `ORDER BY created_at ${dir}`;
      }
      const p = [...params];
      let lim = '';
      if (st._limit != null) {
        lim = ` LIMIT $${p.length + 1}`;
        p.push(st._limit);
      } else if (!multi) {
        lim = ' LIMIT 1';
      }
      const res = await query(`SELECT * FROM livestreams WHERE ${w} ${order}${lim}`, p);
      const Creator = require('./Creator');
      const out = [];
      for (const row of res.rows) {
        let pl = fromRow(row);
        for (const pop of st._populates) {
          if (pop.path === 'creatorId') {
            const cr = await Creator.findById(String(pl.creatorId)).select(pop.select || '').lean().exec();
            pl = { ...pl, creatorId: cr || pl.creatorId };
          }
        }
        out.push(hydrate(pl));
      }
      return multi ? out : out[0] || null;
    },
    then(onF, onR) {
      return c.exec().then(onF, onR);
    },
    catch(onR) {
      return c.exec().catch(onR);
    },
  };
  return c;
}

const Livestream = {
  find(f) {
    return chain(f, true);
  },
  findById(id) {
    return chain({ _id: String(id) }, false);
  },
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO livestreams (id, title, description, thumbnail, audience, scheduled_time, status, creator_id, settings, viewer_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [
        id,
        data.title,
        data.description || '',
        data.thumbnail || 'https://via.placeholder.com/600x400',
        data.audience || 'All members',
        data.scheduledTime || new Date(),
        data.status || 'scheduled',
        String(data.creatorId),
        JSON.stringify(data.settings || {}),
        data.viewerCount ?? 0,
      ]
    );
    return hydrate(fromRow((await query('SELECT * FROM livestreams WHERE id=$1', [id])).rows[0]));
  },
};

module.exports = Livestream;
