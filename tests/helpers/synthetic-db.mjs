import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function syntheticDb(){
 const sql=new DatabaseSync(':memory:');
 // Desired synthetic schema only. Never execute migration files or contact a remote DB.
 sql.exec(readFileSync(new URL('../fixtures/hec-schema.sql',import.meta.url),'utf8'));
 const db={prepare(query){return {bind(...args){return {query,args,async run(){const r=sql.prepare(query).run(...args.map(x=>x??null));return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};},async first(){return sql.prepare(query).get(...args.map(x=>x??null))??null;},async all(){return {results:sql.prepare(query).all(...args.map(x=>x??null))};}};},async all(){return this.bind().all();},async first(){return this.bind().first();},async run(){return this.bind().run();}};},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,db};
}
