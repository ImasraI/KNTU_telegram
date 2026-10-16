// Small SQL adapter for the operations used by this bot. Values always bind as
// parameters; only schema-owned table/column identifiers enter SQL text.
const quote = name => '"' + name.replace(/"/g, '""') + '"';
export function sql(parts, ...values) {
  return { text: parts.join('?'), params: values };
}
sql.raw = text => ({ text, params: [] });
export const eq = (column, value) => ({ column, values: [value], kind: 'eq' });
export const inArray = (column, values) => ({ column, values, kind: 'in' });

export function createDatabase(schema, model, execute) {
  const entries = Object.entries(model).map(([name, meta]) => ({ table: schema[name], ...meta }));
  const tableInfo = table => {
    const info = entries.find(item => item.table === table);
    if (!info) throw new Error('DATABASE_UNKNOWN_TABLE');
    return info;
  };
  const columnInfo = column => {
    // SDK tables manufacture a fresh column descriptor on every property read.
    if (column?._table && column?._col) {
      const owner=entries.find(info=>info.name===column._table);
      const field=owner && Object.values(owner.fields).find(field=>field.name===column._col);
      if(field)return field;
    }
    for (const info of entries) for (const [key, field] of Object.entries(info.fields)) {
      if (info.table[key] === column) return field;
    }
    throw new Error('DATABASE_UNKNOWN_COLUMN');
  };
  const encode = (value, field) => value == null ? null : field?.type === 'json' ? JSON.stringify(value)
    : field?.type === 'boolean' ? Number(!!value) : value instanceof Date ? Math.floor(value.getTime()/1000) : value;
  const decode = (row, info) => {
    const result = {};
    for (const [key, field] of Object.entries(info.fields)) {
      let value = row[field.name];
      if (value != null) {
        if (field.type === 'json') value = JSON.parse(value);
        else if (field.type === 'boolean') value = !!value;
        else if (field.timestamp) value = new Date(value * 1000);
      }
      result[key] = value;
    }
    return result;
  };
  const where = predicate => {
    if (!predicate) return { text: '', params: [] };
    const field = columnInfo(predicate.column), values = predicate.values;
    if (predicate.kind === 'in' && !values.length) return { text: ' WHERE 0', params: [] };
    return { text: ' WHERE ' + quote(field.name) + (predicate.kind === 'in' ? ' IN (' + values.map(()=>'?').join(',') + ')' : ' = ?'), params: values.map(value=>encode(value,field)) };
  };
  const raw = async query => execute({text:query.text,params:query.params ?? []});
  return {
    async run(query) { const result = await raw(query); return { rowsAffected: result.changes }; },
    async all(query) { return (await raw(query)).rows; },
    async get(query) { return (await raw(query)).rows[0] ?? null; },
    async $count(table) { return Number((await execute({text:'SELECT COUNT(*) AS n FROM '+quote(tableInfo(table).name),params:[]})).rows[0].n); },
    select() {
      let table, predicate;
      const query = {
        from(value) { table=value; return query; },
        where(value) { predicate=value; return query; },
        async all() { const info=tableInfo(table), filter=where(predicate); return (await execute({text:'SELECT * FROM '+quote(info.name)+filter.text,params:filter.params})).rows.map(row=>decode(row,info)); },
        async get() { const info=tableInfo(table), filter=where(predicate); const row=(await execute({text:'SELECT * FROM '+quote(info.name)+filter.text+' LIMIT 1',params:filter.params})).rows[0]; return row ? decode(row,info) : undefined; },
      }; return query;
    },
    insert(table) {
      const info=tableInfo(table); let values, conflict;
      const query = {
        values(value) {values=value;return query;},
        onConflictDoUpdate(value) {conflict=value;return query;},
        async run() {
          if (Array.isArray(values)) throw new Error('DATABASE_BULK_INSERT_UNSUPPORTED');
          const keys=Object.keys(values).filter(key=>values[key]!==undefined);
          const fields=keys.map(key=>{if(!info.fields[key])throw new Error('DATABASE_UNKNOWN_FIELD');return info.fields[key];});
          let text='INSERT INTO '+quote(info.name)+' ('+fields.map(field=>quote(field.name)).join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')';
          const params=keys.map(key=>encode(values[key],info.fields[key]));
          if(conflict) {
            const target=columnInfo(conflict.target), changed=Object.keys(conflict.set).filter(key=>conflict.set[key]!==undefined);
            text+=' ON CONFLICT ('+quote(target.name)+') DO UPDATE SET '+changed.map(key=>{if(!info.fields[key])throw new Error('DATABASE_UNKNOWN_FIELD');return quote(info.fields[key].name)+' = ?';}).join(',');
            params.push(...changed.map(key=>encode(conflict.set[key],info.fields[key])));
          }
          const result=await execute({text,params});return {rowsAffected:result.changes};
        },
      };return query;
    },
    update(table) {
      const info=tableInfo(table);let patch,predicate;
      const query={set(value){patch=value;return query;},where(value){predicate=value;return query;},async run(){
        if(!predicate)throw new Error('DATABASE_UPDATE_REQUIRES_FILTER');
        const keys=Object.keys(patch).filter(key=>patch[key]!==undefined),filter=where(predicate);
        const text='UPDATE '+quote(info.name)+' SET '+keys.map(key=>{if(!info.fields[key])throw new Error('DATABASE_UNKNOWN_FIELD');return quote(info.fields[key].name)+' = ?';}).join(',')+filter.text;
        const result=await execute({text,params:[...keys.map(key=>encode(patch[key],info.fields[key])),...filter.params]});return {rowsAffected:result.changes};
      }};return query;
    },
    delete(table) {
      const info=tableInfo(table);let predicate;
      const query={where(value){predicate=value;return query;},async run(){if(!predicate)throw new Error('DATABASE_DELETE_REQUIRES_FILTER');const filter=where(predicate);const result=await execute({text:'DELETE FROM '+quote(info.name)+filter.text,params:filter.params});return {rowsAffected:result.changes};}};return query;
    },
  };
}
