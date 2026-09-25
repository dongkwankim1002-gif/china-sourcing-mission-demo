import { it } from 'vitest';
import { hazardDb } from '../helpers';
it('q', async () => {
  const db = await hazardDb();
  const r = await db.query(`select key, value, jsonb_typeof(value) t from fcd.v_current_settings`);
  console.log(r.map((x:any)=>[x.key, typeof x.value, x.t, JSON.stringify(x.value).slice(0,80)]));
});
